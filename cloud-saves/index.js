const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const simpleGit = require('simple-git');

let fetch;
try {
    import('node-fetch').then(module => {
        fetch = module.default;
    }).catch(() => {
        fetch = require('node-fetch');
    });
} catch (error) {
    console.error('无法导入node-fetch:', error);
    fetch = async (url, options) => {
        const https = require('https');
        const http = require('http');
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            const req = client.request(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        json: async () => JSON.parse(data)
                    });
                });
            });
            req.on('error', reject);
            if (options && options.body) req.write(options.body);
            req.end();
        });
    };
}

const info = {
    id: 'cloud-saves',
    name: 'Cloud Saves',
    description: '通过GitHub仓库创建、管理和恢复SillyTavern的云端存档。',
    version: '1.0.0', // TODO: Consider updating version after refactor
};

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(process.cwd(), 'data');
const DEFAULT_BRANCH = 'main';

const DEFAULT_CONFIG = {
    repo_url: '',
    branch: DEFAULT_BRANCH,
    username: '',
    github_token: '',
    display_name: '',
    is_authorized: false,
    last_save: null,
    current_save: null,
    has_temp_stash: false,
    autoSaveEnabled: false,
    autoSaveInterval: 30,
    autoSaveTargetTag: '',
};

let currentOperation = null;
let autoSaveBackendTimer = null;

async function readConfig() {
    try {
        const data = await fs.readFile(CONFIG_PATH, 'utf8');
        const config = JSON.parse(data);
        config.branch = config.branch || DEFAULT_BRANCH;
        config.autoSaveEnabled = config.autoSaveEnabled === undefined ? DEFAULT_CONFIG.autoSaveEnabled : config.autoSaveEnabled;
        config.autoSaveInterval = config.autoSaveInterval === undefined ? DEFAULT_CONFIG.autoSaveInterval : config.autoSaveInterval;
        config.autoSaveTargetTag = config.autoSaveTargetTag === undefined ? DEFAULT_CONFIG.autoSaveTargetTag : config.autoSaveTargetTag;
        return config;
    } catch (error) {
        console.warn('Failed to read or parse config, creating default:', error.message);
        await fs.writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
        return { ...DEFAULT_CONFIG };
    }
}

async function saveConfig(config) {
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function getGitInstance(cwd = DATA_DIR) {
    const options = {
        baseDir: cwd,
        binary: 'git',
        maxConcurrentProcesses: 6, // Default
    };
    const git = simpleGit(options);
    const config = await readConfig();

    if (cwd === DATA_DIR && config.repo_url && config.github_token) {
        try {
            const remotes = await git.getRemotes(true);
            const origin = remotes.find(r => r.name === 'origin');
            const originalUrl = config.repo_url;
            let authUrl = originalUrl;

            if (originalUrl.startsWith('https://') && !originalUrl.includes('@')) {
                authUrl = originalUrl.replace('https://', `https://x-access-token:${config.github_token}@`);
            }
            if (origin && origin.refs.push !== authUrl) {
                 console.log(`[cloud-saves] Configuring remote 'origin' with auth URL for ${path.basename(cwd)}`);
                 await git.remote(['set-url', 'origin', authUrl]);
            } else if (!origin && originalUrl) {
                 console.log(`[cloud-saves] Adding remote 'origin' with auth URL for ${path.basename(cwd)}`);
                 await git.addRemote('origin', authUrl);
            }
        } catch (error) {
            console.warn(`[cloud-saves] Failed to configure authenticated remote for ${path.basename(cwd)}:`, error.message);
        }
    }
    
    return git;
}

function handleGitError(error, operation = 'Git operation') {
    console.error(`[cloud-saves] ${operation} failed:`, error.message);
    return {
        success: false,
        message: `${operation} failed`,
        details: error.message || error.stack || 'Unknown simple-git error',
        error: error
    };
}

async function isGitInitialized() {
    try {
        const git = simpleGit(DATA_DIR);
        const gitDir = path.join(DATA_DIR, '.git');
        try {
           await fs.access(gitDir);
        } catch {
           return false;
        }
        return await git.checkIsRepo();
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error("[cloud-saves] Error checking git initialization:", error);
        }
        return false;
    }
}

async function addGitkeepRecursively(directory) {
    try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        let hasGitkeep = false;
        const subDirectories = [];

        for (const entry of entries) {
            if (entry.isFile() && entry.name === '.gitkeep') {
                hasGitkeep = true;
            }
            if (entry.isDirectory()) {
                // Skip .git directory itself
                if (entry.name !== '.git') {
                    subDirectories.push(path.join(directory, entry.name));
                }
            }
        }

        // If no .gitkeep found in the current directory, create one
        if (!hasGitkeep) {
            const gitkeepPath = path.join(directory, '.gitkeep');
            try {
                // Check if it exists first, might have been created by another process
                await fs.access(gitkeepPath);
            } catch (e) {
                try {
                    await fs.writeFile(gitkeepPath, ''); // Create empty file
                    console.log(`[cloud-saves] Created .gitkeep in ${path.relative(DATA_DIR, directory) || '.'}`);
                } catch (writeError) {
                    console.error(`[cloud-saves] Failed to create .gitkeep in ${path.relative(DATA_DIR, directory) || '.'}:`, writeError);
                }
            }
        }

        // Recursively call for subdirectories
        for (const subDir of subDirectories) {
            await addGitkeepRecursively(subDir);
        }

    } catch (error) {
        // Log error if directory doesn't exist during recursion, but don't stop the whole process
        if (error.code !== 'ENOENT') {
             console.error(`[cloud-saves] Error processing directory ${path.relative(DATA_DIR, directory) || '.'} for .gitkeep:`, error);
        }
    }
}

async function removeNestedGitFiles(targetPath) {
    try {
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(targetPath, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === '.git') {
                    try {
                        console.warn(`[cloud-saves] Removing nested .git directory: ${entryPath}`);
                        await fs.rm(entryPath, { recursive: true, force: true });
                    } catch (rmError) {
                        console.error(`[cloud-saves] Failed to remove nested .git directory ${entryPath}:`, rmError);
                    }
                } else {
                    // Recursively process other subdirectories within the target path
                    await removeNestedGitFiles(entryPath);
                }
            } else if (entry.isFile() && entry.name === '.gitignore') {
                try {
                    console.warn(`[cloud-saves] Removing nested .gitignore file: ${entryPath}`);
                    await fs.rm(entryPath, { force: true });
                } catch (rmError) {
                    console.error(`[cloud-saves] Failed to remove nested .gitignore file ${entryPath}:`, rmError);
                }
            }
        }
    } catch (error) {
         // If the targetPath itself doesn't exist, just log it and return gracefully.
         if (error.code === 'ENOENT') {
             console.log(`[cloud-saves] Directory ${targetPath} not found for nested git removal, skipping.`);
             return;
         }
        console.error(`[cloud-saves] Error processing directory ${targetPath} for nested git file removal:`, error);
    }
}

// NEW: Helper function to fix gitlink entries in the index for a specific path prefix
async function fixGitlinkEntries(prefix) {
    console.log(`[cloud-saves] Checking index for gitlink entries under prefix: ${prefix}`);
    const git = simpleGit(DATA_DIR); // Use instance pointing to DATA_DIR
    const prefixPath = prefix.endsWith('/') ? prefix : prefix + '/'; // Ensure trailing slash for path matching

    try {
        // Get the index content
        // Format: <mode> <hash> <stage>\t<path>
        const lsFilesOutput = await git.raw('ls-files', '--stage');
        if (!lsFilesOutput) {
            console.log('[cloud-saves] Index is empty, no gitlink entries to fix.');
            return;
        }

        const lines = lsFilesOutput.trim().split('\n');
        const gitlinksToRemove = [];

        for (const line of lines) {
            // Careful parsing: split by space/tab, path is after tab
            const parts = line.split(/\s+/); // Split by whitespace
            if (parts.length >= 4) {
                const mode = parts[0];
                const filePath = parts.slice(3).join(' '); // Rejoin path if it contains spaces

                // Check if it's a gitlink (submodule) and within the target prefix
                if (mode === '160000' && filePath.startsWith(prefixPath)) {
                    console.log(`[cloud-saves] Found gitlink entry to remove from index: ${filePath}`);
                    gitlinksToRemove.push(filePath);
                }
            }
        }

        if (gitlinksToRemove.length === 0) {
            console.log(`[cloud-saves] No gitlink entries found under ${prefixPath}.`);
            return;
        }

        // Remove the identified gitlink entries from the index
        console.log(`[cloud-saves] Removing ${gitlinksToRemove.length} gitlink entries from index...`);
        // Use raw command for rm --cached as simple-git might not directly support removing only from index
        // Use --ignore-unmatch for robustness
        for (const filePath of gitlinksToRemove) {
            try {
                 // Important: Need to quote paths in case they contain spaces
                 // Use raw for precise control over 'rm --cached'
                 await git.raw('rm', '--cached', '--ignore-unmatch', filePath);
                 console.log(`[cloud-saves] Removed ${filePath} from index.`);
            } catch (rmError) {
                 // Log error but continue processing other entries
                 console.error(`[cloud-saves] Failed to remove ${filePath} from index:`, rmError);
            }
        }
        console.log('[cloud-saves] Finished removing gitlink entries from index.');

    } catch (error) {
        console.error(`[cloud-saves] Error fixing gitlink entries under ${prefix}:`, error);
        // Decide if this should be a fatal error for initGitRepo?
        // For now, just log it. Subsequent 'git add' might still work partially.
        throw new Error(`Failed to fix gitlink entries: ${error.message}`); // Re-throw to signal potential issue
    }
}

// 初始化Git仓库 (MODIFIED to include fixing gitlink entries)
async function initGitRepo() {
    if (await isGitInitialized()) {
        console.log('[cloud-saves] Git repository already initialized in data directory.');
        return { success: true, message: 'Git仓库已在data目录中初始化' };
    }

    console.log('[cloud-saves] 正在data目录中初始化Git仓库:', DATA_DIR);
    try {
        const git = simpleGit(DATA_DIR);
        await git.init();
        console.log('[cloud-saves] git init 成功');

        // --- Step 1: Remove nested .git and .gitignore in extensions ---
        const extensionsPath = path.join(DATA_DIR, 'default-user', 'extensions');
        console.warn(`[cloud-saves] WARNING: Removing nested .git/.gitignore within ${extensionsPath} ...`);
        try {
            await fs.access(extensionsPath);
            await removeNestedGitFiles(extensionsPath);
            console.log(`[cloud-saves] Finished removing nested git files within ${extensionsPath}.`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`[cloud-saves] Extensions directory (${extensionsPath}) not found, skipping nested git removal.`);
            } else {
                 console.error(`[cloud-saves] Error accessing extensions directory for cleanup: ${error}`);
            }
        }

        // --- Step 2: Fix gitlink entries in the index for extensions path ---
        const extensionsRelativePath = path.relative(DATA_DIR, extensionsPath).replace(/\\/g, '/'); // Get relative path like 'default-user/extensions'
        try {
            await fixGitlinkEntries(extensionsRelativePath);
        } catch (fixError) {
             // Log the error but potentially continue, as add .gitkeep might still be useful
             console.error('[cloud-saves] WARNING: Failed during gitlink fixing step, proceeding with .gitkeep addition.', fixError);
        }
        // --- END Step 2 ---

        // --- Step 3: Add .gitkeep to ensure directory structure ---
        console.log('[cloud-saves] Adding .gitkeep files to ensure all directory tracking...');
        await addGitkeepRecursively(DATA_DIR);
        console.log('[cloud-saves] Finished adding .gitkeep files.');

        // --- Step 4: Create the main .gitignore ---
        try {
            const gitignorePath = path.join(DATA_DIR, '.gitignore');
            // Corrected content: Use !* to un-ignore everything first, then specify exclusions.
            const gitignoreContent = "# Ensure data directory contents are tracked, overriding parent ignores.\n!*\n\n# Ignore specific subdirectories within data\n_uploads/\n_cache/\n_storage/\n_webpack/\n";
            await fs.writeFile(gitignorePath, gitignoreContent, 'utf8');
            console.log(`[cloud-saves] 已成功创建/更新主 ${gitignorePath}`);
        } catch (gitignoreError) {
            console.error(`[cloud-saves] 创建主 ${path.join(DATA_DIR, '.gitignore')} 文件失败:`, gitignoreError);
        }

        return { success: true, message: 'Git仓库初始化成功，嵌套git文件已清理，索引已修正，并添加了.gitkeep文件' }; // Updated message
    } catch (error) {
        return handleGitError(error, '初始化Git仓库');
    }
}

async function configureRemote(repoUrl) {
    try {
        const git = await getGitInstance();
        const remotes = await git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        
        let authUrl = repoUrl;
        const config = await readConfig();
        if (repoUrl.startsWith('https://') && config.github_token && !repoUrl.includes('@')) {
            authUrl = repoUrl.replace('https://', `https://x-access-token:${config.github_token}@`);
        }

        if (origin) {
            if (origin.refs.push !== authUrl) {
                console.log('[cloud-saves] Updating remote origin URL.');
                await git.remote(['set-url', 'origin', authUrl]);
            }
        } else {
            console.log('[cloud-saves] Adding remote origin.');
            await git.addRemote('origin', authUrl);
        }
        return { success: true, message: '远程仓库配置检查/更新成功' };
    } catch (error) {
        return handleGitError(error, '配置远程仓库');
    }
}

async function createSave(name, description) {
    try {
        currentOperation = 'create_save';
        console.log(`[cloud-saves] 正在创建新存档: ${name}, 描述: ${description}`);
        const config = await readConfig();
        const git = await getGitInstance();
        const branchToPush = config.branch || DEFAULT_BRANCH;

        const encodedName = Buffer.from(name).toString('base64url');
        const tagName = `save_${Date.now()}_${encodedName}`;
        const nowTimestamp = new Date().toISOString();
        const tagMessage = description || `存档: ${name}`;
        const fullTagMessage = `${tagMessage}\nLast Updated: ${nowTimestamp}`;

        await git.add('.');
        const status = await git.status();
        let commitNeeded = !status.isClean();

        if (commitNeeded) {
            console.log('[cloud-saves] 执行提交...');
            try {
                await git.commit(`存档: ${name}`);
            } catch (commitError) {
                if (commitError.message.includes('nothing to commit')) {
                     console.log('[cloud-saves] 提交时无更改。');
                     commitNeeded = false;
                } else {
                    throw commitError;
                }
            }
        }

        console.log('[cloud-saves] 创建标签...');
        await git.addAnnotatedTag(tagName, fullTagMessage);

        console.log('[cloud-saves] 推送更改...');
        const currentBranchStatus = await git.branch();
        const currentBranch = currentBranchStatus.current;

        if (commitNeeded && currentBranch === branchToPush && !currentBranchStatus.detached) {
            console.log(`[cloud-saves] 推送分支: ${currentBranch}`);
            try {
                 await git.push('origin', currentBranch);
            } catch (pushError) {
                console.warn(`[cloud-saves] 推送分支 ${currentBranch} 失败:`, pushError.message);
            }
        } else if (commitNeeded) {
             console.log(`[cloud-saves] 当前不在配置的分支 (${branchToPush}) 或处于 detached HEAD，跳过推送提交。当前: ${currentBranch || 'Detached'}`);
        }

        await git.push(['origin', tagName]);

        config.last_save = {
            name: name,
            tag: tagName,
            timestamp: nowTimestamp,
            description: description || ''
        };
        await saveConfig(config);

        return {
            success: true,
            message: '存档创建成功',
            saveData: {
                ...config.last_save,
                name: name,
                createdAt: nowTimestamp,
                updatedAt: nowTimestamp
            }
        };
    } catch (error) {
        return handleGitError(error, `创建存档 ${name}`);
    } finally {
        currentOperation = null;
    }
}

async function listSaves() {
    try {
        currentOperation = 'list_saves';
        console.log('[cloud-saves] 获取存档列表');
        const git = await getGitInstance();

        // Fetch tags from origin, FORCE update local refs, and PRUNE deleted tags
        console.log('[cloud-saves] Fetching and pruning remote tags...');
        await git.fetch(['origin', '--tags', '--force', '--prune-tags']);

        // Get tags with details (lists local tags after pruning)
        const formatString = "%(refname:short)%00%(creatordate:iso)%00%(taggername)%00%(subject)%00%(contents)";
        const tagOutput = await git.raw('tag', '-l', 'save_*', '--sort=-creatordate', `--format=${formatString}`);

        if (!tagOutput) {
             return { success: true, saves: [] };
        }

        const saves = tagOutput.trim().split('\n').filter(Boolean).map(line => {
            const parts = line.split('\0');
            if (parts.length < 5) return null;

            const tagName = parts[0];
            const createdAt = new Date(parts[1]).toISOString();
            const taggerName = parts[2] || '未知';
            const subject = parts[3];
            const body = parts[4] || '';

            let name = tagName;
            let description = subject;
            let updatedAt = createdAt;

            const bodyLines = body.split('\n');
            const lastUpdatedLine = bodyLines.find(l => l.startsWith('Last Updated:'));
            if (lastUpdatedLine) {
                const timestampStr = lastUpdatedLine.replace('Last Updated:', '').trim();
                const parsedDate = new Date(timestampStr);
                if (!isNaN(parsedDate)) {
                    updatedAt = parsedDate.toISOString();
                }
            } else {
                description = subject;
            }
            
            const tagNameMatch = tagName.match(/^save_\d+_(.+)$/);
            if (tagNameMatch) {
                try {
                    const encodedName = tagNameMatch[1];
                    name = Buffer.from(encodedName, 'base64url').toString('utf8');
                } catch (decodeError) {
                    console.warn(`[cloud-saves] 解码存档名称失败 (${tagName}):`, decodeError);
                    name = tagNameMatch[1];
                }
            }

            return {
                name: name,
                tag: tagName,
                commit: null,
                createdAt: createdAt,
                updatedAt: updatedAt,
                description: description.trim(),
                creator: taggerName
            };
        }).filter(Boolean);

        return { success: true, saves: saves };
    } catch (error) {
        return handleGitError(error, '获取存档列表');
    } finally {
        currentOperation = null;
    }
}

async function loadSave(tagName) {
    try {
        currentOperation = 'load_save';
        console.log(`[cloud-saves] 正在加载存档: ${tagName}`);
        const git = await getGitInstance();
        const config = await readConfig();

        await git.fetch(['origin', '--tags']);
        const tags = await git.tags(['-l', tagName]);
        if (!tags || !tags.all.includes(tagName)) {
            return { success: false, message: '找不到指定的存档标签' };
        }

        const status = await git.status();
        let stashCreated = false;
        if (!status.isClean()) {
            console.log('[cloud-saves] 检测到未保存的更改，在回档前创建临时保存点');
            const stashResult = await git.stash(['push', '-u', '-m', 'Temporary stash before loading save']);
            stashCreated = stashResult && !stashResult.includes('No local changes to save');
             if (stashCreated) {
                 console.log('[cloud-saves] 临时保存点创建成功');
                 config.has_temp_stash = true;
             } else {
                 console.warn('[cloud-saves] 创建临时保存点失败或没有更改需要保存');
                 config.has_temp_stash = false;
             }
        } else {
             config.has_temp_stash = false;
        }
        
        const commit = await git.revparse([tagName]);
        if (!commit) {
            if(stashCreated) await git.stash(['pop']);
             return { success: false, message: '获取存档提交哈希失败' };
        }

        await git.checkout(commit);

        config.current_save = {
            tag: tagName,
            loaded_at: new Date().toISOString()
        };
        await saveConfig(config);

        return {
            success: true,
            message: '存档加载成功',
            stashCreated: stashCreated
        };
    } catch (error) {
        try {
            const cfg = await readConfig();
            if (cfg.has_temp_stash) {
                const git = await getGitInstance();
                console.warn("[cloud-saves] Load failed, attempting to pop temporary stash...");
                await git.stash(['pop']);
                cfg.has_temp_stash = false;
                await saveConfig(cfg);
                console.warn("[cloud-saves] Temporary stash popped after load failure.");
            }
        } catch (popError) {
              console.error("[cloud-saves] Failed to pop temporary stash after load error:", popError);
        }
        return handleGitError(error, `加载存档 ${tagName}`);
    } finally {
        currentOperation = null;
    }
}

async function deleteSave(tagName) {
    try {
        currentOperation = 'delete_save';
        console.log(`[cloud-saves] 正在删除存档: ${tagName}`);
        const git = await getGitInstance();

        await git.tag(['-d', tagName]);
        console.log(`[cloud-saves] 本地标签 ${tagName} 已删除 (或不存在)`);

        let remoteDeleteSuccess = false;
        try {
            await git.push(['origin', `:refs/tags/${tagName}`]);
            console.log(`[cloud-saves] 远程标签 ${tagName} 已删除`);
            remoteDeleteSuccess = true;
        } catch (pushError) {
            if (pushError.message.includes('remote ref does not exist') || pushError.message.includes('deletion of') ) {
                console.log(`[cloud-saves] 远程标签 ${tagName} 不存在或已被删除`);
                remoteDeleteSuccess = true;
            } else {
                 console.warn(`[cloud-saves] 删除远程标签 ${tagName} 失败:`, pushError.message);
                 const config = await readConfig();
                 if (config.current_save && config.current_save.tag === tagName) {
                     config.current_save = null;
                     await saveConfig(config);
                 }
                 return {
                     success: true,
                     message: '本地存档已删除，但删除远程存档失败，可能是网络问题或权限问题',
                     warning: true,
                     details: pushError.message
                 };
            }
        }

        const config = await readConfig();
        if (config.current_save && config.current_save.tag === tagName) {
            config.current_save = null;
            await saveConfig(config);
        }

        return { success: true, message: '存档删除成功' };
    } catch (error) {
        return handleGitError(error, `删除存档 ${tagName}`);
    } finally {
        currentOperation = null;
    }
}

async function renameSave(oldTagName, newName, description) {
    try {
        currentOperation = 'rename_save';
        console.log(`[cloud-saves] 正在重命名存档: ${oldTagName} -> ${newName}`);
        const git = await getGitInstance();
        const config = await readConfig();

        const tags = await git.tags(['-l', oldTagName]);
         if (!tags || !tags.all.includes(oldTagName)) {
             return { success: false, message: '找不到指定的存档标签' };
         }
        const commit = await git.revparse([oldTagName]);
        if (!commit) return { success: false, message: '获取存档提交失败' };

        let oldDecodedName = oldTagName;
        const oldNameMatch = oldTagName.match(/^save_\d+_(.+)$/);
        if (oldNameMatch) {
            try { oldDecodedName = Buffer.from(oldNameMatch[1], 'base64url').toString('utf8'); } catch (e) { /* ignore */ }
        }

        const nowTimestamp = new Date().toISOString();
        const newDescription = description || `存档: ${newName}`;
        const fullNewMessage = `${newDescription}\nLast Updated: ${nowTimestamp}`;

        if (oldDecodedName === newName) {
            console.log(`[cloud-saves] 名称未变，仅更新标签描述和时间戳: ${oldTagName}`);
            await git.tag(['-a', '-f', oldTagName, '-m', fullNewMessage, commit]);
            await git.push(['origin', oldTagName, '--force']);
             return { success: true, message: '存档描述和更新时间已更新', oldTag: oldTagName, newTag: oldTagName, newName: newName };
        } else {
             console.log(`[cloud-saves] 名称已更改，执行完整重命名流程...`);
             const encodedNewName = Buffer.from(newName).toString('base64url');
             const newTagName = `save_${Date.now()}_${encodedNewName}`;

             console.log(`[cloud-saves] 创建新标签: ${newTagName}`);
             await git.addAnnotatedTag(newTagName, fullNewMessage, commit);

             console.log(`[cloud-saves] 推送新标签: ${newTagName}`);
             try {
                await git.push('origin', newTagName);
             } catch (pushError) {
                  await git.tag(['-d', newTagName]);
                  throw pushError;
             }

             console.log(`[cloud-saves] 删除旧本地标签: ${oldTagName}`);
             await git.tag(['-d', oldTagName]);

             console.log(`[cloud-saves] 删除旧远程标签: ${oldTagName}`);
             try {
                 await git.push(['origin', `:refs/tags/${oldTagName}`]);
             } catch(deleteRemoteError) {
                  if (!deleteRemoteError.message.includes('remote ref does not exist')) {
                      console.warn(`[cloud-saves] 删除旧远程标签 ${oldTagName} 失败:`, deleteRemoteError.message);
                  }
             }

            if (config.current_save && config.current_save.tag === oldTagName) {
                config.current_save.tag = newTagName;
                await saveConfig(config);
            }

            return { success: true, message: '存档重命名成功', oldTag: oldTagName, newTag: newTagName, newName: newName };
        }
    } catch (error) {
        return handleGitError(error, `重命名存档 ${oldTagName} -> ${newName}`);
    } finally {
        currentOperation = null;
    }
}

async function getSaveDiff(ref1, ref2) {
    try {
        currentOperation = 'get_save_diff';
        console.log(`[cloud-saves] 获取差异: ${ref1} <-> ${ref2}`);
        const git = simpleGit(DATA_DIR);
        const emptyTreeHash = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

        try {
            await git.revparse(['--verify', ref1]);
        } catch (error) {
            if ((ref1.endsWith('^') || ref1.endsWith('~1')) && error.message.includes('unknown revision')) {
                console.warn(`[cloud-saves] 无法解析引用 ${ref1}，可能为初始提交的父提交。尝试与空树比较。`);
                ref1 = emptyTreeHash;
            } else if (ref1 === emptyTreeHash) {
                
            }
            else {
                 return { success: false, message: `找不到或无效的引用: ${ref1}`, details: error.message };
            }
        }
        try {
            await git.revparse(['--verify', ref2]);
        } catch (error) {
             return { success: false, message: `找不到或无效的引用: ${ref2}`, details: error.message };
        }

        let diffOutput;
         try {
             if (ref1 === emptyTreeHash) {
                  console.log(`[cloud-saves] 与空树比较 (${ref2})，使用 'git ls-tree' 显示初始提交内容。`);
                 const lsTreeOutput = await git.raw('ls-tree', '-r', '--name-only', ref2);
                 if (!lsTreeOutput) return { success: true, changedFiles: [] };
                 changedFiles = lsTreeOutput.trim().split('\n').filter(Boolean).map(fileName => ({
                     status: 'A',
                     fileName: fileName
                 }));
                 return { success: true, changedFiles: changedFiles };
             } else {
                 diffOutput = await git.diff(['--name-status', ref1, ref2]);
             }
         } catch (diffError) {
              return handleGitError(diffError, `获取差异 ${ref1} <-> ${ref2}`);
         }

        const changedFiles = diffOutput.trim().split('\n')
            .filter(Boolean)
            .map(line => {
                const [status, ...fileParts] = line.split(/\s+/);
                const fileName = fileParts.join(' ');
                return { status, fileName };
            });

        return {
            success: true,
            changedFiles: changedFiles
        };
    } catch (error) {
        return handleGitError(error, `获取存档差异 ${ref1} <-> ${ref2}`);
    } finally {
        currentOperation = null;
    }
}

async function getGitStatus() {
    try {
        const git = simpleGit(DATA_DIR);
        const isInitialized = await isGitInitialized();

        let status = null;
        if (isInitialized) {
            status = await git.status();
        }

        let currentBranch = null;
        let isDetached = false;
        if (isInitialized) {
             try {
                 const branchSummary = await git.branch();
                 currentBranch = branchSummary.current;
                 isDetached = branchSummary.detached;
             } catch (branchError) {
                  console.warn('[cloud-saves] 获取分支信息失败:', branchError.message);
             }
        }

        const config = await readConfig();
        const currentSave = config.current_save;

        const formattedStatus = {
             initialized: isInitialized,
             changes: status ? status.files.map(f => `${f.working_dir}${f.index} ${f.path}`) : [],
             currentBranch: isDetached ? null : currentBranch,
             currentSave: currentSave,
             isDetached: isDetached,
             ahead: status ? status.ahead : 0,
             behind: status ? status.behind : 0,
        };
        
        return formattedStatus;

    } catch (error) {
        console.error('获取Git状态时出错:', error);
        throw handleGitError(error, '获取Git状态');
    }
}

async function hasUnsavedChanges() {
    try {
        const git = simpleGit(DATA_DIR);
        if (!await isGitInitialized()) return false;
        const status = await git.status();
        return !status.isClean();
    } catch (error) {
         console.error('[cloud-saves]检查未保存更改时出错:', error);
         return false;
    }
}

async function checkTempStash() {
    const config = await readConfig();
    if (!config.has_temp_stash) {
        return { exists: false };
    }

    try {
        const git = simpleGit(DATA_DIR);
        const stashList = await git.stashList();

        if (stashList.total === 0) {
            config.has_temp_stash = false;
            await saveConfig(config);
            return { exists: false };
        }
        const tempStash = stashList.all.find(s => s.message.includes('Temporary stash before loading save'));
         if (!tempStash) {
            config.has_temp_stash = false;
            await saveConfig(config);
            return { exists: false };
         }

        return { exists: true };
    } catch (error) {
        console.error('[cloud-saves] Error checking stash list:', error);
        return { exists: config.has_temp_stash, error: 'Failed to check stash list' };
    }
}

async function applyTempStash() {
    const config = await readConfig();
    if (!config.has_temp_stash) {
        return { success: false, message: 'No temporary stash found in config' };
    }

    try {
        const git = simpleGit(DATA_DIR);
        console.log('[cloud-saves][DEBUG] Checking stash list in applyTempStash...');
        const stashList = await git.stashList();
        console.log('[cloud-saves][DEBUG] Stash list result:', JSON.stringify(stashList, null, 2));

        const stashMessageToFind = 'Temporary stash before loading save';
        // Use findIndex to get the index of the stash
        const stashIndex = stashList.all.findIndex(s => s.message && s.message.includes(stashMessageToFind));

        // DEBUG LOG: Print the found index
        console.log(`[cloud-saves][DEBUG] Found tempStash index: ${stashIndex}`);

        if (stashIndex === -1) { // Check if index was found
            console.warn('[cloud-saves] Temporary stash message not found in list. Clearing flag.');
            config.has_temp_stash = false;
            await saveConfig(config);
            return { success: false, message: `Stash with message "${stashMessageToFind}" not found in stash list` };
        }

        // Construct the stash reference using the index
        const stashRef = `stash@{${stashIndex}}`;

        // DEBUG LOG: Print the constructed stashRef value
        console.log(`[cloud-saves][DEBUG] Constructed stash ref to apply/drop: ${stashRef}`);

        // No need for undefined check anymore as we construct it directly

        console.log(`[cloud-saves] Applying temporary stash: ${stashRef}`);
        await git.stash(['apply', stashRef]);

        console.log(`[cloud-saves] Dropping temporary stash: ${stashRef}`);
        try {
            await git.stash(['drop', stashRef]);
        } catch (dropError) {
            console.error(`[cloud-saves] Failed to drop stash ${stashRef} after applying:`, dropError);
            config.has_temp_stash = false; // Still clear flag maybe? Or leave it? Let's clear it and return warning.
            await saveConfig(config);
            return handleGitError(dropError, `应用成功但丢弃Stash ${stashRef} 失败`);
        }

        config.has_temp_stash = false;
        await saveConfig(config);

        return { success: true, message: 'Temporary stash applied and dropped successfully' };
    } catch (error) {
        return handleGitError(error, '应用临时Stash');
    }
}

async function discardTempStash() {
    const config = await readConfig();
    if (!config.has_temp_stash) {
        return { success: false, message: 'No temporary stash found in config' };
    }

    try {
        const git = simpleGit(DATA_DIR);
        console.log('[cloud-saves][DEBUG] Checking stash list in discardTempStash...');
        const stashList = await git.stashList();
        console.log('[cloud-saves][DEBUG] Stash list result:', JSON.stringify(stashList, null, 2));

        const stashMessageToFind = 'Temporary stash before loading save';
        // Use findIndex to get the index of the stash
        const stashIndex = stashList.all.findIndex(s => s.message && s.message.includes(stashMessageToFind));

        // DEBUG LOG: Print the found index
        console.log(`[cloud-saves][DEBUG] Found tempStash index: ${stashIndex}`);

        if (stashIndex === -1) { // Check if index was found
            console.warn('[cloud-saves] Temporary stash message not found in list. Clearing flag.');
            config.has_temp_stash = false;
            await saveConfig(config);
            return { success: true, message: `Stash with message "${stashMessageToFind}" already gone or not found` };
        }

        // Construct the stash reference using the index
        const stashRef = `stash@{${stashIndex}}`;

        // DEBUG LOG: Print the constructed stashRef value
        console.log(`[cloud-saves][DEBUG] Constructed stash ref to drop: ${stashRef}`);

        // No need for undefined check

        console.log(`[cloud-saves] Dropping temporary stash: ${stashRef}`);
        await git.stash(['drop', stashRef]);

        config.has_temp_stash = false;
        await saveConfig(config);

        return { success: true, message: 'Temporary stash discarded' };
    } catch (error) {
        return handleGitError(error, '丢弃临时Stash');
    }
}

async function performAutoSave() {
    if (currentOperation) {
        console.log(`[Cloud Saves Auto] 跳过自动存档，当前有操作正在进行: ${currentOperation}`);
        return;
    }
    currentOperation = 'auto_save';
    let config;
    let git;
    try {
        config = await readConfig();
        if (!config.is_authorized || !config.autoSaveEnabled || !config.autoSaveTargetTag) {
            console.log('[Cloud Saves Auto] 自动存档条件不满足，跳过。');
            currentOperation = null;
            return;
        }

        const targetTag = config.autoSaveTargetTag;
        console.log(`[Cloud Saves Auto] 开始自动覆盖存档到: ${targetTag}`);
        git = await getGitInstance();
        const branchToUse = config.branch || DEFAULT_BRANCH;

        let originalDescription = `Auto Save Overwrite: ${targetTag}`;
        try {
             const tagInfoRaw = await git.raw('tag', '-n1', '-l', targetTag, '--format=%(contents)');
             if (tagInfoRaw) {
                 originalDescription = tagInfoRaw.trim().split('\n')[0];
             }
        } catch (tagInfoError) {
             console.warn(`[Cloud Saves Auto] 获取旧标签 ${targetTag} 信息失败，将使用默认描述。`, tagInfoError.message);
        }

        await git.add('.');
        const status = await git.status();
        const hasChanges = !status.isClean();
        let newCommitHash;

        if (hasChanges) {
            const commitMessage = `Auto Save Overwrite: ${targetTag}`;
            try {
                const commitResult = await git.commit(commitMessage);
                 newCommitHash = commitResult.commit;
                 console.log('[Cloud Saves Auto] 新自动存档提交哈希:', newCommitHash);
                try {
                    await git.push('origin', branchToUse);
                } catch (pushCommitError) {
                    console.warn(`[Cloud Saves Auto] 推送自动存档提交到分支 ${branchToUse} 失败:`, pushCommitError.message);
                }
            } catch (commitError) {
                if (commitError.message.includes('nothing to commit')) {
                    console.log('[Cloud Saves Auto] 自动存档时无实际更改可提交，将使用当前 HEAD');
                    newCommitHash = await git.revparse('HEAD');
                } else {
                     throw commitError;
                }
            }
        } else {
            console.log('[Cloud Saves Auto] 自动存档时无实际更改可提交，将使用当前 HEAD');
            newCommitHash = await git.revparse('HEAD');
        }

        if (!newCommitHash) {
            throw new Error('无法确定用于自动存档的提交哈希');
        }

        try {
             await git.tag(['-d', targetTag]);
        } catch (delLocalErr) { /* Ignore if local doesn't exist */ }
        try {
            await git.push(['origin', `:refs/tags/${targetTag}`]);
        } catch (delRemoteErr) {
            if (!delRemoteErr.message.includes('remote ref does not exist')) {
                 console.warn(`[Cloud Saves Auto] 删除远程旧标签 ${targetTag} 时遇到问题:`, delRemoteErr.message);
            }
        }

        const nowTimestampOverwrite = new Date().toISOString();
        const fullTagMessageOverwrite = `${originalDescription}\nLast Updated: ${nowTimestampOverwrite}`;
        await git.addAnnotatedTag(targetTag, fullTagMessageOverwrite, newCommitHash);

        try {
             await git.push('origin', targetTag);
        } catch (pushTagError) {
             await git.tag(['-d', targetTag]);
             throw pushTagError;
        }

        console.log(`[Cloud Saves Auto] 成功自动覆盖存档: ${targetTag}`);

    } catch (error) {
        console.error(`[Cloud Saves Auto] 自动覆盖存档失败 (${config?.autoSaveTargetTag}):`, error);
    } finally {
        currentOperation = null;
    }
}

function setupBackendAutoSaveTimer() {
    if (autoSaveBackendTimer) {
        console.log('[Cloud Saves] 清除现有的后端自动存档定时器。');
        clearInterval(autoSaveBackendTimer);
        autoSaveBackendTimer = null;
    }

    readConfig().then(config => {
        if (config.is_authorized && config.autoSaveEnabled && config.autoSaveTargetTag) {
            const intervalMinutes = config.autoSaveInterval > 0 ? config.autoSaveInterval : 30;
            const intervalMilliseconds = intervalMinutes * 60 * 1000;
            if (intervalMilliseconds < 60000) {
                 console.warn(`[Cloud Saves] 自动存档间隔 (${intervalMinutes}分钟) 过短，已调整为最少 1 分钟。`);
                 intervalMilliseconds = 60000;
            }
            console.log(`[Cloud Saves] 启动后端定时存档，间隔 ${intervalMinutes} 分钟，目标: ${config.autoSaveTargetTag}`);
            autoSaveBackendTimer = setInterval(performAutoSave, intervalMilliseconds);
        } else {
            console.log('[Cloud Saves] 后端定时存档未启动（未授权/未启用/无目标）。');
        }
    }).catch(err => {
        console.error('[Cloud Saves] 启动后端定时器前读取配置失败:', err);
    });
}

async function init(router) {
    console.log('[cloud-saves] 初始化云存档插件 (simple-git)...');
    console.log('[cloud-saves] 插件 UI 访问地址 (如果端口不是8000请自行修改): http://127.0.0.1:8000/api/plugins/cloud-saves/ui');

    try {
        router.use('/static', express.static(path.join(__dirname, 'public')));
        router.use(express.json());
        router.get('/ui', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        router.get('/info', (req, res) => {
            res.json(info);
        });

        router.get('/config', async (req, res) => {
            try {
                const config = await readConfig();
                const safeConfig = {
                    repo_url: config.repo_url || '',
                    display_name: config.display_name || '',
                    branch: config.branch || DEFAULT_BRANCH,
                    is_authorized: config.is_authorized || false,
                    username: config.username || null,
                    autoSaveEnabled: config.autoSaveEnabled || false,
                    autoSaveInterval: config.autoSaveInterval || 30,
                    autoSaveTargetTag: config.autoSaveTargetTag || '',
                    has_github_token: !!config.github_token,
                };
                // console.log('[cloud-saves][DEBUG] Sending GET /config response:', JSON.stringify(safeConfig));
                res.json(safeConfig);
            } catch (error) {
                res.status(500).json({ success: false, message: '读取配置失败', error: error.message });
            }
        });

        router.post('/config', async (req, res) => {
            try {
                const {
                    repo_url, github_token, display_name, branch, is_authorized,
                    autoSaveEnabled, autoSaveInterval, autoSaveTargetTag
                } = req.body;
                let currentConfig = await readConfig();
                // DEBUG: console.log('[cloud-saves][DEBUG] Received POST /config request body:', JSON.stringify(req.body, (key, value) => key === 'github_token' && value ? '******' : value)); // Mask token in log

                currentConfig.repo_url = repo_url !== undefined ? repo_url.trim() : currentConfig.repo_url;
                if (github_token) {
                    // DEBUG: console.log('[cloud-saves][DEBUG] Saving new GitHub token (length:', github_token.length, ')');
                    currentConfig.github_token = github_token;
                } else {
                    // DEBUG: console.log('[cloud-saves][DEBUG] No new GitHub token provided in POST /config request.');
                }
                currentConfig.display_name = display_name !== undefined ? display_name.trim() : currentConfig.display_name;
                currentConfig.branch = branch !== undefined ? (branch.trim() || DEFAULT_BRANCH) : currentConfig.branch;
                if (is_authorized !== undefined) {
                    currentConfig.is_authorized = !!is_authorized;
                }
                if (autoSaveEnabled !== undefined) {
                    currentConfig.autoSaveEnabled = !!autoSaveEnabled;
                }
                if (autoSaveInterval !== undefined) {
                    const interval = parseFloat(autoSaveInterval);
                    if (isNaN(interval) || interval <= 0) {
                        return res.status(400).json({ success: false, message: '无效的自动存档间隔。请输入一个大于 0 的数字。' });
                    }
                    currentConfig.autoSaveInterval = interval;
                }
                if (autoSaveTargetTag !== undefined) {
                    currentConfig.autoSaveTargetTag = autoSaveTargetTag.trim();
                }

                await saveConfig(currentConfig);
                // DEBUG: console.log('[cloud-saves][DEBUG] Config saved successfully after POST /config.');

                setupBackendAutoSaveTimer();

                const safeConfig = {
                    repo_url: currentConfig.repo_url,
                    display_name: currentConfig.display_name,
                    branch: currentConfig.branch,
                    is_authorized: currentConfig.is_authorized,
                    username: currentConfig.username,
                    autoSaveEnabled: currentConfig.autoSaveEnabled,
                    autoSaveInterval: currentConfig.autoSaveInterval,
                    autoSaveTargetTag: currentConfig.autoSaveTargetTag
                };
                // console.log('[cloud-saves][DEBUG] Sending POST /config response:', JSON.stringify(safeConfig));
                res.json({ success: true, message: '配置保存成功', config: safeConfig });
            } catch (error) {
                console.error('[cloud-saves] 保存配置失败:', error);
                res.status(500).json({ success: false, message: '保存配置失败', error: error.message });
            }
        });

        router.post('/authorize', async (req, res) => {
             let authGit; 
            try {
                const { branch } = req.body;
                let config = await readConfig();
                const targetBranch = branch || config.branch || DEFAULT_BRANCH;

                if (!config.repo_url || !config.github_token) {
                    return res.status(400).json({ success: false, message: '仓库URL和GitHub Token未配置，请先保存设置' });
                }

                if (branch && config.branch !== targetBranch) {
                    config.branch = targetBranch;
                }
                config.is_authorized = false;

                const initResult = await initGitRepo();
                if (!initResult.success) {
                    return res.status(500).json({ success: false, message: initResult.message, details: initResult.details });
                }
                
                authGit = simpleGit(DATA_DIR);

                try {
                     console.log('[cloud-saves] 准备初始提交...');
                     await authGit.add('.');
                     const status = await authGit.status();
                     if (!status.isClean()) {
                         console.log('[cloud-saves] 执行初始提交...');
                         // Add local config for user identity before committing
                         try {
                             console.log('[cloud-saves] Configuring local Git identity for initial commit...');
                             await authGit.addConfig('user.name', 'Cloud Saves Plugin', false, 'local');
                             await authGit.addConfig('user.email', 'cloud-saves@plugin.local', false, 'local');
                             console.log('[cloud-saves] Local Git identity configured.');
                         } catch (configError) {
                             console.error('[cloud-saves] Failed to configure local Git identity:', configError);
                             // Decide if this should prevent the commit? For now, log and continue, commit might still fail.
                         }
                         await authGit.commit('Initial commit of existing data directory');
                         console.log('[cloud-saves] 初始提交完成。');
                     } else {
                         console.log('[cloud-saves] data 目录无更改，跳过初始提交。');
                     }
                 } catch (initialCommitError) {
                      if (!initialCommitError.message.includes('nothing to commit')) {
                           console.error('[cloud-saves] 执行初始提交时出错:', initialCommitError);
                           return res.status(500).json({ success: false, message: `创建初始提交失败: ${initialCommitError.message}` });
                      }
                      console.log('[cloud-saves] 初始提交时无更改 (捕获异常)。');
                 }

                let authUrl = config.repo_url;
                if (config.repo_url.startsWith('https://') && !config.repo_url.includes('@')) {
                    authUrl = config.repo_url.replace('https://', `https://x-access-token:${config.github_token}@`);
                }
                const remotes = await authGit.getRemotes(true);
                const origin = remotes.find(r => r.name === 'origin');
                if (origin) {
                     if (origin.refs.push !== authUrl) {
                        await authGit.remote(['set-url', 'origin', authUrl]);
                     }
                } else {
                     await authGit.addRemote('origin', authUrl);
                }
                console.log('[cloud-saves] 远程仓库已配置');

                try {
                    await authGit.fetch(['origin', '--tags', '--prune', '--force']);
                    console.log("[cloud-saves] 获取标签成功。");
                } catch(fetchError) {
                     await saveConfig(config);
                     return res.status(400).json({
                         success: false,
                         message: '配置错误或权限不足：无法访问远程仓库或获取标签，请检查URL、Token权限。',
                         details: fetchError.message
                     });
                }
                
                console.log(`[cloud-saves] 检查远程分支 ${targetBranch}...`);
                let remoteBranchExists = false;
                 try {
                     const remoteHeads = await authGit.listRemote(['--heads', 'origin', targetBranch]);
                     remoteBranchExists = typeof remoteHeads === 'string' && remoteHeads.includes(`refs/heads/${targetBranch}`);
                 } catch (lsRemoteError) {
                      console.warn(`[cloud-saves] ls-remote 检查分支 ${targetBranch} 失败，假设其不存在。错误:`, lsRemoteError.message);
                      remoteBranchExists = false;
                 }


                if (!remoteBranchExists) {
                    console.log(`[cloud-saves] 远程分支 ${targetBranch} 不存在，尝试创建...`);
                    try {
                        const localBranches = await authGit.branchLocal();
                         if (!localBranches.all.includes(targetBranch)) {
                             console.log(`[cloud-saves] 创建本地分支 ${targetBranch}...`);
                             await authGit.checkout(['-b', targetBranch]); 
                         } else {
                              await authGit.checkout(targetBranch);
                         }
                         
                        console.log(`[cloud-saves] 推送以创建远程分支 ${targetBranch}...`);
                        await authGit.push(['--set-upstream', 'origin', targetBranch]);
                        console.log(`[cloud-saves] 远程分支 ${targetBranch} 创建成功`);
                    } catch (createBranchError) {
                         console.error(`[cloud-saves] 自动创建/推送分支 ${targetBranch} 失败:`, createBranchError);
                         await saveConfig(config);
                         if (createBranchError.message.includes('non-fast-forward')) {
                              return res.status(500).json({ success: false, message: `远程分支 ${targetBranch} 已存在，但本地历史与之冲突 (non-fast-forward)。请尝试手动解决或选择其他分支名。`, details: createBranchError.message });
                         }
                         return res.status(500).json({ success: false, message: `无法自动创建或同步远程分支 ${targetBranch}。错误：${createBranchError.message}`, details: createBranchError.message });
                    }
                } else {
                    // Remote branch exists: Do nothing regarding local branch state.
                    // The successful fetch/ls-remote earlier is sufficient validation.
                    console.log(`[cloud-saves] 远程分支 ${targetBranch} 已存在。连接验证成功，不修改本地分支。`);
                }

                config.is_authorized = true;
                config.branch = targetBranch;

                try {
                    const validationResponse = await fetch('https://api.github.com/user', {
                        headers: { 'Authorization': `token ${config.github_token}` }
                    });
                    if (validationResponse.ok) {
                        const userData = await validationResponse.json();
                        config.username = userData.login || null;
                    } else {
                        console.warn(`[cloud-saves] 获取GitHub用户名失败: ${validationResponse.status}`);
                    }
                } catch (fetchUserError) {
                    console.warn('[cloud-saves] 获取GitHub用户名时发生网络错误:', fetchUserError.message);
                }

                await saveConfig(config);
                setupBackendAutoSaveTimer();

                const safeConfig = {
                    repo_url: config.repo_url,
                    display_name: config.display_name,
                    branch: config.branch,
                    is_authorized: config.is_authorized,
                    username: config.username,
                    autoSaveEnabled: config.autoSaveEnabled,
                    autoSaveInterval: config.autoSaveInterval,
                    autoSaveTargetTag: config.autoSaveTargetTag
                };

                res.json({ success: true, message: '授权和配置成功', config: safeConfig });

            } catch (error) {
                 console.error("[cloud-saves] 授权过程中发生严重错误:", error);
                 try {
                      let cfg = await readConfig();
                      cfg.is_authorized = false;
                      await saveConfig(cfg);
                 } catch (saveErr) { /* Ignore */ }
                 setupBackendAutoSaveTimer();
                res.status(500).json({ success: false, message: '授权过程中发生错误', error: error.message });
            }
        });

        router.get('/status', async (req, res) => {
            try {
                const status = await getGitStatus();
                const tempStashStatus = await checkTempStash();
                res.json({ success: true, status: { ...status, tempStash: tempStashStatus } });
            } catch (error) {
                res.status(500).json({ success: false, message: error.message || '获取状态失败', details: error.details });
            }
        });

        router.get('/saves', async (req, res) => {
            if (currentOperation) {
                return res.status(409).json({ success: false, message: `正在进行操作: ${currentOperation}` });
            }
            try {
                const result = await listSaves();
                res.json(result);
            } catch (error) {
                res.status(500).json(error);
            }
        });

        router.post('/saves', async (req, res) => {
            if (currentOperation) {
                return res.status(409).json({ success: false, message: `正在进行操作: ${currentOperation}` });
            }
            try {
                const { name, description } = req.body;
                if (!name) {
                    return res.status(400).json({ success: false, message: '需要提供存档名称' });
                }
                const result = await createSave(name, description);
                res.json(result);
            } catch (error) {
                 console.error('[cloud-saves] Unexpected error in POST /saves:', error);
                 res.status(500).json({ success: false, message: '创建存档时发生意外错误', details: error.message });
            }
        });

        router.post('/saves/load', async (req, res) => {
            if (currentOperation) {
                return res.status(409).json({ success: false, message: `正在进行操作: ${currentOperation}` });
            }
            try {
                const { tagName } = req.body;
                if (!tagName) {
                    return res.status(400).json({ success: false, message: '需要提供存档标签名' });
                }
                const result = await loadSave(tagName);
                res.json(result);
            } catch (error) {
                console.error('[cloud-saves] Unexpected error in POST /saves/load:', error);
                res.status(500).json({ success: false, message: '加载存档时发生意外错误', details: error.message });
            }
        });

        router.delete('/saves/:tagName', async (req, res) => {
            if (currentOperation) {
                return res.status(409).json({ success: false, message: `正在进行操作: ${currentOperation}` });
            }
            try {
                const { tagName } = req.params;
                if (!tagName) {
                    return res.status(400).json({ success: false, message: '需要提供存档标签名' });
                }
                const result = await deleteSave(tagName);
                res.json(result);
            } catch (error) {
                console.error('[cloud-saves] Unexpected error in DELETE /saves/:tagName:', error);
                res.status(500).json({ success: false, message: '删除存档时发生意外错误', details: error.message });
            }
        });

        router.put('/saves/:oldTagName', async (req, res) => {
            if (currentOperation) {
                return res.status(409).json({ success: false, message: `正在进行操作: ${currentOperation}` });
            }
            try {
                const { oldTagName } = req.params;
                const { newName, description } = req.body;
                if (!oldTagName || !newName) {
                    return res.status(400).json({ success: false, message: '需要提供旧存档标签名和新名称' });
                }
                const result = await renameSave(oldTagName, newName, description);
                res.json(result);
            } catch (error) {
                console.error('[cloud-saves] Unexpected error in PUT /saves/:oldTagName:', error);
                res.status(500).json({ success: false, message: '重命名存档时发生意外错误', details: error.message });
            }
        });

        router.get('/saves/diff', async (req, res) => {
            if (currentOperation) {
                return res.status(409).json({ success: false, message: `正在进行操作: ${currentOperation}` });
            }
            try {
                const { tag1, tag2 } = req.query;
                if (!tag1 || !tag2) {
                    return res.status(400).json({ success: false, message: '需要提供两个存档标签名/引用' });
                }
                const result = await getSaveDiff(tag1, tag2);
                res.json(result);
            } catch (error) {
                console.error('[cloud-saves] Unexpected error in GET /saves/diff:', error);
                res.status(500).json({ success: false, message: '获取存档差异时发生意外错误', details: error.message });
            }
        });

        router.post('/stash/apply', async (req, res) => {
            if (currentOperation) {
                return res.status(409).json({ success: false, message: `正在进行操作: ${currentOperation}` });
            }
            try {
                const result = await applyTempStash();
                res.json(result);
            } catch (error) {
                 console.error('[cloud-saves] Unexpected error in POST /stash/apply:', error);
                res.status(500).json({ success: false, message: '应用临时Stash时发生意外错误', details: error.message });
            }
        });

        router.post('/stash/discard', async (req, res) => {
            if (currentOperation) {
                return res.status(409).json({ success: false, message: `正在进行操作: ${currentOperation}` });
            }
            try {
                const result = await discardTempStash();
                res.json(result);
            } catch (error) {
                 console.error('[cloud-saves] Unexpected error in POST /stash/discard:', error);
                res.status(500).json({ success: false, message: '丢弃临时Stash时发生意外错误', details: error.message });
            }
        });

        router.post('/saves/:tagName/overwrite', async (req, res) => {
            if (currentOperation) {
                return res.status(409).json({ success: false, message: `正在进行操作: ${currentOperation}` });
            }
            currentOperation = 'overwrite_save';
            const { tagName } = req.params;
            let git;
            try {
                const config = await readConfig();
                if (!config.is_authorized) {
                    return res.status(401).json({ success: false, message: '未授权，请先连接仓库' });
                }
                console.log(`[cloud-saves] 准备覆盖存档: ${tagName}`);
                git = await getGitInstance();
                const branchToUse = config.branch || DEFAULT_BRANCH;

                let originalDescription = `Overwrite of ${tagName}`;
                try {
                     const tagInfoRaw = await git.raw('tag', '-n1', '-l', tagName, '--format=%(contents)');
                     if (tagInfoRaw) {
                         originalDescription = tagInfoRaw.trim().split('\n')[0];
                     }
                } catch (tagInfoError) { /* Ignore */ }

                await git.add('.');
                const status = await git.status();
                const hasChanges = !status.isClean();
                let newCommitHash;

                if (hasChanges) {
                    const commitMessage = `Overwrite save: ${tagName}`;
                    console.log(`[cloud-saves] 创建覆盖提交: "${commitMessage}"`);
                    try {
                        const commitResult = await git.commit(commitMessage);
                        newCommitHash = commitResult.commit;
                        console.log(`[cloud-saves] 新覆盖提交哈希: ${newCommitHash}`);
                        try {
                            await git.push('origin', branchToUse);
                        } catch (pushCommitError) {
                            console.warn(`[cloud-saves] 推送覆盖提交到分支 ${branchToUse} 失败:`, pushCommitError.message);
                        }
                    } catch (commitError) {
                         if (commitError.message.includes('nothing to commit')) {
                             console.log('[cloud-saves] 覆盖时无实际更改可提交，将使用当前 HEAD');
                             newCommitHash = await git.revparse('HEAD');
                         } else {
                             throw commitError;
                         }
                    }
                } else {
                    console.log('[cloud-saves] 覆盖时无实际更改可提交，将使用当前 HEAD');
                    newCommitHash = await git.revparse('HEAD');
                }

                 if (!newCommitHash) throw new Error('无法确定用于覆盖的提交哈希');

                try { await git.tag(['-d', tagName]); } catch(e) {/*ignore*/}
                try {
                    await git.push(['origin', `:refs/tags/${tagName}`]);
                } catch (delRemoteErr) {
                     if (!delRemoteErr.message.includes('remote ref does not exist')) {
                          console.warn(`[cloud-saves] 删除远程旧标签 ${tagName} 时遇到问题:`, delRemoteErr.message);
                     }
                }

                const tagMessage = originalDescription;
                const nowTimestampOverwrite = new Date().toISOString();
                const fullTagMessageOverwrite = `${tagMessage}\nLast Updated: ${nowTimestampOverwrite}`;
                await git.addAnnotatedTag(tagName, fullTagMessageOverwrite, newCommitHash);

                try {
                    await git.push('origin', tagName);
                } catch (pushTagError) {
                     await git.tag(['-d', tagName]);
                     throw pushTagError;
                }

                const saveNameMatch = tagName.match(/^save_\d+_(.+)$/);
                let saveName = tagName;
                if (saveNameMatch) { try { saveName = Buffer.from(saveNameMatch[1], 'base64url').toString('utf8'); } catch (e) {/*ignore*/} }
                if (config.last_save && config.last_save.tag === tagName) {
                    config.last_save = { name: saveName, tag: tagName, timestamp: nowTimestampOverwrite, description: originalDescription };
                    await saveConfig(config);
                }

                res.json({ success: true, message: '存档覆盖成功' });

            } catch (error) {
                console.error(`[cloud-saves] 覆盖存档 ${tagName} 失败:`, error);
                res.status(500).json(handleGitError(error, `覆盖存档 ${tagName}`));
            } finally {
                currentOperation = null;
            }
        });

        router.post('/initialize', async (req, res) => {
            if (currentOperation) {
                return res.status(409).json({ success: false, message: `正在进行操作: ${currentOperation}` });
            }
            currentOperation = 'initialize_repo';
            try {
                console.log('[cloud-saves] 收到强制初始化仓库请求...');
                const config = await readConfig();

                const gitDirPath = path.join(DATA_DIR, '.git');
                try {
                    console.log(`[cloud-saves] 强制删除旧的 ${gitDirPath} 目录...`);
                    await fs.rm(gitDirPath, { recursive: true, force: true });
                    console.log(`[cloud-saves] 已强制删除旧的 ${gitDirPath} 目录`);
                } catch (rmError) {
                    console.error(`[cloud-saves] 删除旧的 ${gitDirPath} 目录失败 (可能不存在或权限问题):`, rmError);
                }

                const initResult = await initGitRepo();
                if (!initResult.success) {
                    return res.status(500).json({ success: false, message: `初始化Git仓库失败: ${initResult.message}`, details: initResult.details });
                }
                console.log('[cloud-saves] git init 成功 (强制)');

                 const git = simpleGit(DATA_DIR);

                try {
                     console.log('[cloud-saves] 添加初始提交 (强制)...');
                     await git.add('.');
                     const status = await git.status();
                     if (!status.isClean()) {
                         await git.commit('Initial commit after forced re-initialization');
                         console.log('[cloud-saves] 初始提交完成 (强制)');
                     } else {
                         console.log('[cloud-saves] data 目录无更改，跳过初始提交 (强制)');
                     }
                 } catch (initialCommitError) {
                      if (!initialCommitError.message.includes('nothing to commit')) {
                           console.error('[cloud-saves] 执行初始提交时出错 (强制):', initialCommitError);
                      }
                 }

                if (config.repo_url) {
                    console.log(`[cloud-saves] 配置远程仓库 (强制): ${config.repo_url}`);
                    let authUrl = config.repo_url;
                     if (config.github_token && authUrl.startsWith('https://') && !authUrl.includes('@')) {
                         authUrl = config.repo_url.replace('https://', `https://x-access-token:${config.github_token}@`);
                     }
                     try {
                          try { await git.removeRemote('origin'); } catch(e) {/*ignore*/}
                          await git.addRemote('origin', authUrl);
                          console.log('[cloud-saves] 配置远程仓库成功 (强制)');
                     } catch (remoteError) {
                          console.error('[cloud-saves] 配置远程仓库失败 (强制):', remoteError);
                          return res.json({
                              success: true,
                              message: '仓库初始化成功，但配置远程仓库失败，请检查仓库 URL 或后续手动配置。',
                              warning: true,
                              details: remoteError.message
                          });
                     }
                } else {
                    console.log('[cloud-saves] 未配置仓库 URL，跳过配置远程仓库 (强制)');
                }

                res.json({ success: true, message: '仓库强制初始化成功' + (config.repo_url ? ' 并已配置远程仓库' : '') });

            } catch (error) {
                console.error('[cloud-saves] 强制初始化仓库时发生错误:', error);
                res.status(500).json(handleGitError(error, '强制初始化仓库'));
            } finally {
                currentOperation = null;
            }
        });

        router.post('/update/check-and-pull', async (req, res) => {
            if (currentOperation) {
                return res.status(409).json({ success: false, message: `正在进行操作: ${currentOperation}` });
            }
            currentOperation = 'check_update';
            const pluginDir = __dirname;
             const targetRemoteUrl = 'https://github.com/fuwei99/cloud-saves.git';
             const targetBranch = 'main';
             let git;

            try {
                console.log('[cloud-saves] 开始检查插件更新...');
                 git = simpleGit(pluginDir); 

                const isRepo = await git.checkIsRepo();
                if (!isRepo) {
                    console.warn('[cloud-saves] 插件目录不是有效的 Git 仓库。');
                    return res.json({ success: true, status: 'not_git_repo', message: '无法自动更新：插件似乎不是通过 Git 安装的。' });
                }

                const remotes = await git.getRemotes(true);
                const origin = remotes.find(r => r.name === 'origin');
                if (!origin) {
                     return res.json({ success: false, status: 'no_remote', message: '无法更新：插件仓库未配置名为 "origin" 的远程。' });
                }
                
                const localRemoteUrl = origin.refs.push;
                const targetRemoteWithoutGit = targetRemoteUrl.replace('.git', '');
                if (localRemoteUrl !== targetRemoteUrl && localRemoteUrl !== targetRemoteWithoutGit) {
                    console.warn(`[cloud-saves] 插件仓库的远程地址 (${localRemoteUrl}) 与目标 (${targetRemoteUrl}) 不匹配。`);
                    return res.json({
                        success: false,
                        status: 'wrong_remote',
                        message: `无法更新：插件远程地址 (${localRemoteUrl}) 与预期 (${targetRemoteUrl}) 不符。请确保插件是从官方地址克隆的。`
                    });
                }

                 console.log('[cloud-saves] Fetching updates from origin...');
                 await git.fetch('origin', targetBranch);

                 const localHash = await git.revparse('HEAD');
                 const remoteHash = await git.revparse(`origin/${targetBranch}`);

                console.log(`[cloud-saves] 本地版本: ${localHash}`);
                console.log(`[cloud-saves] 远程版本 (origin/${targetBranch}): ${remoteHash}`);

                if (localHash === remoteHash) {
                    console.log('[cloud-saves] 当前已是最新版本。');
                    return res.json({ success: true, status: 'latest', message: '已是最新版本。' });
                }

                 const status = await git.status();
                 if (!status.isClean()) {
                     console.warn('[cloud-saves] 检测到本地修改，无法自动拉取更新。');
                     return res.json({
                         success: false,
                         status: 'local_changes',
                         message: '无法更新：检测到插件文件有本地修改。请先儲藏(stash)或提交您的更改，或手动执行 git pull。'
                     });
                 }

                console.log('[cloud-saves] 检测到新版本，尝试执行 git pull...');
                const pullSummary = await git.pull('origin', targetBranch); 

                 if (pullSummary.files && pullSummary.files.length > 0 || pullSummary.summary.changes > 0) {
                      console.log('[cloud-saves] git pull 成功！', pullSummary.summary);
                      return res.json({ success: true, status: 'updated', message: '插件更新成功！请务必重启 SillyTavern 服务以应用更改。' });
                 } else if (pullSummary.summary.alreadyUpdated) {
                      console.log('[cloud-saves] Pull 表示已是最新 (可能 fetch 后状态已更新)');
                       return res.json({ success: true, status: 'latest', message: '已是最新版本。' });
                 }
                 else {
                      console.error('[cloud-saves] git pull 执行完成，但似乎未成功更新或状态未知。', pullSummary);
                      return res.json({
                           success: false,
                           status: 'pull_failed',
                           message: `更新似乎失败或状态未知。请检查控制台日志或尝试手动执行 git pull。`
                      });
                 }

            } catch (error) {
                console.error('[cloud-saves] 检查或执行插件更新时出错:', error);
                res.status(500).json({ success: false, status:'error', message: `检查更新时发生内部错误: ${error.message}` });
            } finally {
                currentOperation = null;
            }
        });

        setupBackendAutoSaveTimer();

    } catch (error) {
        console.error('[cloud-saves] 插件初始化失败:', error);
    }
}

const plugin = {
    info: info,
    init: init,
};

module.exports = plugin;
