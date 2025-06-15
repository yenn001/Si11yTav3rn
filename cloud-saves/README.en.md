[中文说明](./README.md)
# Cloud Saves - Easily Backup and Sync Your SillyTavern Data with GitHub!

Hello everyone!

Have you ever worried about accidentally losing your meticulously crafted SillyTavern character cards, precious chat logs, or painstakingly configured world info? Or perhaps you wish you could conveniently sync your SillyTavern experience across different computers or devices?

To address these concerns, I've developed and am sharing a brand new SillyTavern plugin: **Cloud Saves**!

## 🌟 What Can Cloud Saves Help You With?

The core function of this plugin is to securely back up your SillyTavern `/data` directory (which includes characters, chat logs, groups, world info, plugin data, and almost all other user data) to your own **private GitHub repository**.

With Cloud Saves, you can:

*   **🔒 Secure Data Backup**: No more worrying about data loss due to local hard drive failures or accidental deletions.
*   **🔄 Version Rollback**: Easily restore your SillyTavern to any previous save point.
*   **☁️ Cloud Sync**: (Potential capability) If you use SillyTavern on multiple devices, you can use this to sync data (requires manually loading saves).
*   **🏷️ Clear Management**: Conveniently create, name, view, rename, and delete your cloud saves.
*   **⏱️ Automatic Saves**: Set up scheduled tasks to automatically back up your latest state.


## ✨ Key Features:

*   **One-Click Cloud Save Creation**: Save the current state of your `/data` directory as a new cloud save point (Git Tag).
*   **Convenient Save Loading**: Select a save from the list to restore your `/data` directory to that state (**Warning: This will overwrite local data!**).
*   **Flexible Save Management**:
    *   List all cloud saves with their creation times and descriptions.
    *   Rename saves and modify descriptions.
    *   Delete cloud saves you no longer need (also deletes the remote Git Tag).
    *   Compare the differences between a cloud save and your current local data.
*   **Scheduled Auto-Save**: Can be configured and enabled to automatically overwrite a specified cloud save with the current state (suitable for periodic backups).

---

## 🚀 Getting Started: Installation and Configuration Steps

### Step 1: Preparation (Very Important!)

1.  **Check SillyTavern Root Directory (File Deletion No Longer Required)**:
    *   *Previous versions required deleting the root `.git` folder and `.gitignore` file to avoid conflicts.*
    *   *The plugin has been updated to correctly handle nested repositories. You **no longer need** to delete these files. Keeping the root `.git` folder is important for updating SillyTavern.*
    *   *If you previously deleted the root `.git` folder based on old instructions, it's recommended to restore it from a backup or by re-downloading SillyTavern to ensure you can update SillyTavern itself.*
2.  **Modify SillyTavern Configuration**:
    *   Find and open the `config.yaml` file in your SillyTavern root directory with a text editor.
    *   Scroll to the **very bottom** of the file. Find or add the following two lines, **modifying or ensuring** their values are set as shown:
        ```yaml
        enableServerPlugins: true
        enableServerPluginsAutoUpdate: false
        ```
    *   *Explanation: `enableServerPlugins` enables the plugin feature. Setting `enableServerPluginsAutoUpdate` to `false` is recommended to avoid potential auto-update conflicts.*
    *   Save and close the `config.yaml` file.
3.  **Install Prerequisites**:
    *   **Git**: Ensure Git is installed on your computer or server. You can check by typing `git --version` in your command line/terminal. If not installed, visit the [official Git website](https://git-scm.com/downloads) to download and install it for your operating system (Windows/Linux/MacOS).
    *   **Node.js and npm**: This plugin requires the Node.js environment to run. Installing Node.js typically includes npm (Node Package Manager) automatically.
        *   Visit the [official Node.js website](https://nodejs.org/) to download and install the LTS (Long Term Support) version.
        *   After installation, you can check if it was successful by typing `node -v` and `npm -v` in your command line/terminal.

### Step 2: Install the Plugin and Dependencies

1.  **Get the Plugin Code** (Choose one method):
    *   **Method 1: Download ZIP Package**:
        *   Visit the plugin's GitHub repository: [https://github.com/fuwei99/cloud-saves](https://github.com/fuwei99/cloud-saves)
        *   Click on "Code" -> "Download ZIP".
        *   Extract the downloaded `cloud-saves-main.zip` file.
        *   Place the extracted `cloud-saves` folder (make sure it's named exactly this) into the `plugins` folder within your SillyTavern root directory. The path should look like `SillyTavern/plugins/cloud-saves`.
    *   **Method 2: Use Git Clone**:
        *   Open your command line/terminal.
        *   `cd` into the `plugins` folder in your SillyTavern root directory (e.g., `cd path/to/SillyTavern/plugins`).
        *   Run the command: `git clone https://github.com/fuwei99/cloud-saves.git`. This will automatically create the `cloud-saves` folder.
2.  **Install Plugin Dependencies (Crucial Step!)**:
    *   **Open your command line/terminal**.
    *   **`cd` into the newly created plugin directory**:
        ```bash
        cd path/to/SillyTavern/plugins/cloud-saves
        ```
        (Replace `path/to/SillyTavern` with your actual SillyTavern path)
    *   **Run the installation command**:
        ```bash
        npm install
        ```
    *   Wait for the command to complete. It will automatically download and install the libraries needed for the plugin to run (this will create a `node_modules` folder). `WARN` messages can usually be ignored, but `ERR!` indicates an error – check your Node.js/npm installation or network connection.

### Step 3: Restart SillyTavern

*   Shut down the currently running SillyTavern service (if it's running).
*   Restart SillyTavern. This launch will load the new `config.yaml` settings and attempt to load the Cloud Saves plugin and its dependencies.

### Step 4: Configure the Cloud Saves Plugin

1.  **Open the Plugin Interface**:
    *   Method 1: In the SillyTavern interface, find "Plugins" in the left-side menu, click it, and then select "Cloud Saves".
    *   Method 2: **Directly access the plugin panel URL**: [`http://127.0.0.1:8000/api/plugins/cloud-saves/ui`](http://127.0.0.1:8000/api/plugins/cloud-saves/ui)
        *   **Note**: If your SillyTavern is not running on the default port `8000`, change `8000` in the link above to your actual port number.
2.  **Create a GitHub Repository**:
    *   Go to GitHub and create a new repository. **It is highly recommended to make it Private!** Choose any name you like, e.g., `sillytavern-saves`. You **do not** need to initialize the repository (e.g., by adding a README).
    *   Copy the repository's HTTPS URL (e.g., `https://github.com/YourUsername/sillytavern-saves.git`).
3.  **Create a GitHub Personal Access Token (PAT)**:
    *   Visit your GitHub [Personal access tokens](https://github.com/settings/tokens) page.
    *   Generate a new token (using "Classic" tokens is recommended for simpler permission setup).
    *   **Key Permission**: You **must** grant the token **at least the `repo` scope**.
    *   Set an expiration duration (setting "No expiration" is recommended to avoid frequent replacements).
    *   **Copy the generated token immediately and save it securely!** It will only be shown once.
4.  **Enter Information in the Plugin**:
    *   Go back to the Cloud Saves plugin interface, in the "Repository Authorization Settings" section:
        *   Paste your **Repository URL**.
        *   Paste your generated **GitHub Access Token**.
        *   (Optional) Enter a **Display Name** (helps identify who made the changes).
        *   (Optional) Set the **Branch** (defaults to `main`, usually doesn't need changing).
5.  **Save Configuration**:
    *   Click the **"Configure"** button.
6.  **Authorize and Connect (with Error Handling)**:
    *   Click the **"Authorize & Connect"** button.
    *   **If successful**: You'll see a success message, and the interface will show the repository status, indicating configuration is complete!
    *   **If it fails or shows an error**:
        *   **First, try**: Clicking the **"Initialize Repository"** button. This attempts to create the Git repository in your local SillyTavern `/data` directory and perform necessary initial setup.
        *   After successful initialization, **click "Authorize & Connect" again**.
        *   If it still fails, double-check:
            *   Is your GitHub token pasted correctly and not expired?
            *   Does the token have the correct `repo` permissions?
            *   Is the Repository URL correct?
            *   Can your network access GitHub properly?
            *   Did you complete the cleanup steps in **Step 1**?
            *   Did `npm install` run successfully without errors?

### Step 5: Start Using It!

Once successfully configured and connected, you can start enjoying the benefits of cloud saves:

*   **Create New Save**: Enter a name and description in the "Create New Save" section, then click "Save Current State".
*   **Load Save**: Find the save in the "Save List" and click the download icon <i class="bi bi-cloud-download"></i> (**Warning again: This will overwrite local data!**).
*   **Manage Saves**: Use the edit <i class="bi bi-pencil"></i>, overwrite <i class="bi bi-upload"></i>, delete <i class="bi bi-trash"></i>, and compare <i class="bi bi-file-diff"></i> buttons in the list.
*   **Set Up Auto-Save**: Configure and enable in the "Scheduled Auto-Save Settings" section.

---

## 🔗 Links:

*   **GitHub Repository (Code, Detailed Info, Download)**: [https://github.com/fuwei99/cloud-saves](https://github.com/fuwei99/cloud-saves)

## 💬 Feedback and Support:

Feel free to try it out! If you encounter any issues while using it or have suggestions for features, please reply directly in the forum thread (if applicable) or, preferably, open an [Issue](https://github.com/fuwei99/cloud-saves/issues) on the GitHub repository page.

Hope this plugin is helpful to everyone!