[English Readme](./README.en.md)
# Cloud Saves - 使用 GitHub 轻松备份和同步你的 SillyTavern 数据！

大家好！

你是否曾经担心过不小心丢失精心培养的 SillyTavern 角色卡、珍贵的聊天记录或者辛苦配置的世界信息？或者你希望能在不同的电脑或设备之间方便地同步你的 SillyTavern 体验？

为了解决这些问题，我开发并分享一个全新的 SillyTavern 插件：**Cloud Saves**！

## 🌟 Cloud Saves 能帮你做什么？

这个插件的核心功能是将你的 SillyTavern `/data` 目录（包含角色、聊天记录、群组、世界信息、插件数据等几乎所有用户数据）安全地备份到你自己的 **私有 GitHub 仓库** 中。

通过 Cloud Saves，你可以：

*   **🔒 数据安全备份**：再也不用担心本地硬盘故障或误操作导致数据丢失。
*   **🔄 版本回滚**：轻松将你的 SillyTavern 恢复到过去的任何一个存档点。
*   **☁️ 云端同步**：（潜在能力）如果你在多台设备上使用 SillyTavern，可以用它来同步数据（需要手动加载存档）。
*   **🏷️ 清晰管理**：方便地创建、命名、查看、重命名和删除你的云端存档。
*   **⏱️ 自动存档**：设置定时任务，让插件自动帮你备份最新的状态。


## ✨ 主要功能：

*   **一键创建云存档**：将当前 `/data` 目录状态保存为一个新的云端存档点（Git Tag）。
*   **方便加载云存档**：从列表中选择一个存档，将 `/data` 目录恢复到该状态（**注意：会覆盖本地数据！**）。
*   **灵活管理存档**：
    *   列出所有云端存档及其创建时间、描述。
    *   重命名存档，修改描述。
    *   删除不再需要的云存档（同时删除远程 Git Tag）。
    *   比较云存档与当前本地数据的差异。
*   **定时自动存档**：可配置启用，自动将当前状态覆盖到你指定的某个云存档（适合做周期性备份）。

---

## 🚀 开始使用：安装与配置步骤

### 第一步：准备工作 (非常重要！)

1.  **检查 SillyTavern 根目录 (不再需要删除文件)**:
    *   *先前版本需要删除根目录的 `.git` 和 `.gitignore` 以避免冲突。*
    *   *现在插件已更新，可以正确处理嵌套仓库，**不再需要**删除这些文件。保留根目录的 `.git` 对更新 SillyTavern 很重要。*
    *   *如果你之前按照旧说明删除了根目录的 `.git` 文件夹，建议从备份或重新下载 SillyTavern 来恢复它，以便能正常更新 SillyTavern 本身。*
2.  **修改 SillyTavern 配置**:
    *   找到并用文本编辑器打开 SillyTavern 根目录下的 `config.yaml` 文件。
    *   滚动到文件 **最末尾**，找到或添加以下两行，**修改或确保**它们的值如下设置：
        ```yaml
        enableServerPlugins: true
        enableServerPluginsAutoUpdate: false
        ```
    *   *说明：`enableServerPlugins` 开启插件功能，`enableServerPluginsAutoUpdate` 设置为 `false` 可以避免潜在的自动更新冲突 (推荐)。*
    *   保存并关闭 `config.yaml` 文件。
3.  **安装必备软件**:
    *   **Git**: 确保你的电脑或服务器上安装了 Git。可以在命令行输入 `git --version` 检查。如果没有安装，请根据你的操作系统（Windows/Linux/MacOS）访问 [Git 官网](https://git-scm.com/downloads) 下载并安装。
    *   **Node.js 和 npm**: 这个插件需要 Node.js 环境来运行。安装 Node.js 通常会自动包含 npm (Node Package Manager)。
        *   访问 [Node.js 官网](https://nodejs.org/) 下载并安装 LTS (长期支持) 版本。
        *   安装完成后，可以在命令行输入 `node -v` 和 `npm -v` 来检查是否安装成功。

### 第二步：安装插件并安装依赖

1.  **获取插件代码** (选择一种方式):
    *   **方式一：下载 Zip 包**:
        *   访问插件 GitHub 仓库: [https://github.com/fuwei99/cloud-saves](https://github.com/fuwei99/cloud-saves)
        *   点击 "Code" -> "Download ZIP"。
        *   解压下载的 `cloud-saves-main.zip`。
        *   将解压得到的 `cloud-saves` 文件夹（确保是这个名字）放入你 SillyTavern 根目录下的 `plugins` 文件夹内。路径看起来应该是 `SillyTavern/plugins/cloud-saves`。
    *   **方式二：使用 Git Clone**:
        *   打开命令行/终端。
        *   `cd` 到你的 SillyTavern 根目录下的 `plugins` 文件夹 (例如 `cd path/to/SillyTavern/plugins`)。
        *   运行命令：`git clone https://github.com/fuwei99/cloud-saves.git` 这会自动创建 `cloud-saves` 文件夹。
2.  **安装插件依赖 (关键步骤!)**:
    *   **打开命令行/终端**。
    *   **`cd` 进入刚刚创建的插件目录**:
        ```bash
        cd path/to/SillyTavern/plugins/cloud-saves
        ```
        (请将 `path/to/SillyTavern` 替换为你实际的 SillyTavern 路径)
    *   **运行安装命令**:
        ```bash
        npm install
        ```
    *   等待命令执行完成。它会自动下载并安装插件运行所需的库文件 (会创建一个 `node_modules` 文件夹)。如果看到 `WARN` 信息通常可以忽略，但如果看到 `ERR!` 则表示出错，需要检查 Node.js/npm 安装或网络连接。

### 第三步：重启 SillyTavern

*   关闭当前正在运行的 SillyTavern 服务 (如果正在运行)。
*   重新启动 SillyTavern。这次启动会加载 `config.yaml` 的新设置并尝试加载 Cloud Saves 插件及其依赖。

### 第四步：配置 Cloud Saves 插件

1.  **打开插件界面**:
    *   方法一：在 SillyTavern 界面左侧菜单找到 "Plugins" (或 "插件")，点击进入，然后选择 "Cloud Saves"。
    *   方法二：**直接访问插件面板链接**: [`http://127.0.0.1:8000/api/plugins/cloud-saves/ui`](http://127.0.0.1:8000/api/plugins/cloud-saves/ui)
        *   **注意**: 如果你的 SillyTavern 不是运行在默认的 `8000` 端口，请将上面链接中的 `8000` 修改为你实际使用的端口号。
2.  **创建 GitHub 仓库**:
    *   去 GitHub 创建一个新的仓库。**强烈建议设为私有 (Private)**！仓库名随意，例如 `sillytavern-saves`。你**不需要**初始化仓库（比如添加 README）。
    *   复制仓库的 HTTPS URL (例如 `https://github.com/YourUsername/sillytavern-saves.git`)。
3.  **创建 GitHub 令牌 (PAT)**:
    *   访问 GitHub [个人访问令牌](https://github.com/settings/tokens) 页面。
    *   生成一个新令牌 (推荐使用 Classic Token 以简化权限设置)。
    *   **关键权限**: 必须授予令牌**至少 `repo` 权限**。
    *   设置令牌有效期（推荐 "No expiration"）。
    *   **复制并妥善保存好生成的令牌**！它只显示一次。
4.  **在插件中填写信息**:
    *   回到 Cloud Saves 插件界面，在 "仓库授权设置" (Repository Authorization Settings) 部分：
        *   粘贴你的 **仓库 URL**。
        *   粘贴你生成的 **GitHub 访问令牌**。
        *   (可选) 输入 **显示名称** (方便区分是谁的操作)。
        *   (可选) 设置 **分支** (默认 `main`，一般无需修改)。
5.  **保存配置**:
    *   点击 **"配置" (Configure)** 按钮。
6.  **授权与连接 (含错误处理)**:
    *   点击 **"授权并连接" (Authorize & Connect)** 按钮。
    *   **如果连接成功**: 你会看到成功的提示，并且界面会显示仓库状态，表示配置完成！
    *   **如果连接失败或报错**:
        *   **首先尝试**: 点击 **"初始化仓库" (Initialize Repository)** 按钮。这个按钮会尝试在你本地的 SillyTavern `/data` 目录下创建 Git 仓库并进行必要的初始设置。
        *   初始化成功后，**再次点击 "授权并连接"**。
        *   如果仍然失败，请仔细检查：
            *   你的 GitHub 令牌是否正确粘贴，并且没有过期？
            *   令牌是否具有正确的 `repo` 权限？
            *   仓库 URL 是否正确？
            *   你的网络是否能正常访问 GitHub？
            *   是否完成了 **第一步** 中的清理工作？
            *   `npm install` 是否成功执行且没有报错？

### 第五步：开始使用！

一旦配置并连接成功，你就可以开始享受云存档带来的便利了：

*   **创建新存档**：在 "创建新存档" (Create New Save) 区域输入名称和描述，点击 "保存当前状态" (Save Current State)。
*   **加载存档**：在 "存档列表" (Save List) 中找到存档，点击下载图标 <i class="bi bi-cloud-download"></i>（**再次警告：会覆盖本地数据！**）。
*   **管理存档**：使用列表中的编辑 <i class="bi bi-pencil"></i>、覆盖 <i class="bi bi-upload"></i>、删除 <i class="bi bi-trash"></i>、比较 <i class="bi bi-file-diff"></i> 等按钮。
*   **设置自动存档**：在 "定时自动存档设置" (Scheduled Auto-Save Settings) 区域配置并启用。

---

## 🔗 链接：

*   **GitHub 仓库 (代码、详细说明、下载)**: [https://github.com/fuwei99/cloud-saves](https://github.com/fuwei99/cloud-saves)

## 💬 反馈与支持：

欢迎大家试用！如果你在使用中遇到任何问题，或者有功能建议，请直接在这个帖子下面回复，或者最好是在 GitHub 仓库的 [Issues](https://github.com/fuwei99/cloud-saves/issues) 页面提出。

希望这个插件能对大家有所帮助！
