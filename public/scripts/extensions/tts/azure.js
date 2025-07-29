import { event_types, eventSource, getRequestHeaders } from '../../../script.js';
import { SECRET_KEYS, secret_state } from '../../secrets.js';
import { getPreviewString, saveTtsProviderSettings } from './index.js';
export { AzureTtsProvider };

class AzureTtsProvider {
    //########//
    // Config //
    //########//

    settings;
    voices = [];
    separator = ' . ';
    audioElement = document.createElement('audio');

    defaultSettings = {
        region: '',
        voiceMap: {},
    };

    get settingsHtml() {
        let html = `
        <div class="azure_tts_settings">
            <div class="flex-container alignItemsBaseline">
                <h4 for="azure_tts_key" class="flex1 margin0">
                    <a href="https://portal.azure.com/" target="_blank">Azure TTS Key</a>
                </h4>
                <div id="azure_tts_key" class="menu_button menu_button_icon manage-api-keys" data-key="api_key_azure_tts">
                    <i class="fa-solid fa-key"></i>
                    <span>Click to set</span>
                </div>
            </div>
            <label for="azure_tts_region">Region:</label>
            <input id="azure_tts_region" type="text" class="text_pole" placeholder="e.g. westus" />
            <hr>
        </div>
        `;
        return html;
    }

    constructor() {
        this.handler = async function (/** @type {string} */ key) {
            if (key !== SECRET_KEYS.AZURE_TTS) return;
            $('#azure_tts_key').toggleClass('success', !!secret_state[SECRET_KEYS.AZURE_TTS]);
            await this.onRefreshClick();
        }.bind(this);
    }

    dispose() {
        [event_types.SECRET_WRITTEN, event_types.SECRET_DELETED, event_types.SECRET_ROTATED].forEach(event => {
            eventSource.removeListener(event, this.handler);
        });
    }

    onSettingsChange() {
        // Update dynamically
        this.settings.region = String($('#azure_tts_region').val());
        // Reset voices
        this.voices = [];
        saveTtsProviderSettings();
    }

    async loadSettings(settings) {
        // Populate Provider UI given input settings
        if (Object.keys(settings).length == 0) {
            console.info('Using default TTS Provider settings');
        }

        // Only accept keys defined in defaultSettings
        this.settings = this.defaultSettings;

        for (const key in settings) {
            if (key in this.settings) {
                this.settings[key] = settings[key];
            } else {
                throw `Invalid setting passed to TTS Provider: ${key}`;
            }
        }

        $('#azure_tts_region').val(this.settings.region).on('input', () => this.onSettingsChange());
        $('#azure_tts_key').toggleClass('success', !!secret_state[SECRET_KEYS.AZURE_TTS]);
        [event_types.SECRET_WRITTEN, event_types.SECRET_DELETED, event_types.SECRET_ROTATED].forEach(event => {
            eventSource.on(event, this.handler);
        });

        try {
            await this.checkReady();
            console.debug('Azure: Settings loaded');
        } catch {
            console.debug('Azure: Settings loaded, but not ready');
        }
    }

    // Perform a simple readiness check by trying to fetch voiceIds
    async checkReady() {
        if (secret_state[SECRET_KEYS.AZURE_TTS]) {
            await this.fetchTtsVoiceObjects();
        } else {
            this.voices = [];
        }
    }

    async onRefreshClick() {
        await this.checkReady();
    }

    //#################//
    //  TTS Interfaces //
    //#################//

    async getVoice(voiceName) {
        if (this.voices.length == 0) {
            this.voices = await this.fetchTtsVoiceObjects();
        }
        const match = this.voices.filter(
            voice => voice.name == voiceName,
        )[0];
        if (!match) {
            throw `TTS Voice name ${voiceName} not found`;
        }
        return match;
    }

    async generateTts(text, voiceId) {
        const response = await this.fetchTtsGeneration(text, voiceId);
        return response;
    }

    //###########//
    // API CALLS //
    //###########//
    async fetchTtsVoiceObjects() {
        if (!secret_state[SECRET_KEYS.AZURE_TTS]) {
            console.warn('Azure TTS API Key not set');
            return [];
        }

        if (!this.settings.region) {
            console.warn('Azure TTS region not set');
            return [];
        }

        const response = await fetch('/api/azure/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                region: this.settings.region,
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        let responseJson = await response.json();
        responseJson = responseJson
            .sort((a, b) => a.Locale.localeCompare(b.Locale) || a.ShortName.localeCompare(b.ShortName))
            .map(x => ({ name: x.ShortName, voice_id: x.ShortName, preview_url: false, lang: x.Locale }));
        return responseJson;
    }

    /**
     * Preview TTS for a given voice ID.
     * @param {string} id Voice ID
     */
    async previewTtsVoice(id) {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        const voice = await this.getVoice(id);
        const text = getPreviewString(voice.lang);
        const response = await this.fetchTtsGeneration(text, id);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const audio = await response.blob();
        const url = URL.createObjectURL(audio);
        this.audioElement.src = url;
        this.audioElement.play();
        this.audioElement.onended = () => URL.revokeObjectURL(url);
    }

    async fetchTtsGeneration(text, voiceId) {
        if (!secret_state[SECRET_KEYS.AZURE_TTS]) {
            throw new Error('Azure TTS API Key not set');
        }

        if (!this.settings.region) {
            throw new Error('Azure TTS region not set');
        }

        const response = await fetch('/api/azure/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                text: text,
                voice: voiceId,
                region: this.settings.region,
            }),
        });

        if (!response.ok) {
            toastr.error(response.statusText, 'TTS Generation Failed');
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        return response;
    }
}
