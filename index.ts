import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, makeRange } from "@utils/types";
import { ChannelType } from "@vencord/discord-types/enums";
import { VoiceState } from "@vencord/discord-types/src/stores";
import { findByPropsLazy } from "@webpack";
import { PermissionsBits } from "@webpack/common";
import { AuthenticationStore, ChannelStore, PermissionStore, SelectedChannelStore, UserStore } from "@webpack/common/stores";

const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");

let shouldReconnect: boolean = true;

const settings = definePluginSettings({
    automaticallyReconnect: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Whether to automatically reconnect to voice channels."
    },
    minimumDelay: {
        type: OptionType.SLIDER,
        description: "Minimum delay in seconds before reconnecting.",
        markers: makeRange(0.5, 5, 0.5),
        stickToMarkers: true,
        default: 0.5
    },
    maximumDelay: {
        type: OptionType.SLIDER,
        description: "Maximum delay in seconds before reconnecting.",
        markers: makeRange(0.5, 5, 0.5),
        stickToMarkers: true,
        default: 1
    }
});

function canJoinChannel(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);

    if (!channel) return false;
    if (channel.type != ChannelType.GUILD_VOICE) return false;

    return PermissionStore.can(PermissionsBits.CONNECT, channel);
}

function setReconnectFlag(value: boolean) {
    shouldReconnect = value;
}

export default definePlugin({
    name: "AutoReconnect",
    description: "Automatically reconnect to voice channels after a random delay when someone disconnects you.",
    authors: [
        {
            id: 644298972420374528n,
            name: "Nick"
        }
    ],
    settings,
    patches: [
        {
            find: "this.selectVoiceChannel(null)",
            replacement: {
                match: /disconnect\(\){/,
                replace: "$&$self.updateShouldReconnect(false);"
            }
        }
    ],
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!settings.store.automaticallyReconnect) return;

            const currentChannelId = SelectedChannelStore.getVoiceChannelId();
            const currentUserId = UserStore.getCurrentUser().id;

            for (const state of voiceStates) {
                const { userId, oldChannelId } = state;
                if (userId !== currentUserId) continue;

                if (state.sessionId !== AuthenticationStore.getSessionId()) continue;

                if (oldChannelId && !currentChannelId) {
                    if (shouldReconnect) {
                        const minDelay = Math.max(0.5, settings.store.minimumDelay); // absolute minimum of 0.5 seconds
                        const maxDelay = settings.store.maximumDelay;
                        setTimeout(() => {
                            if (canJoinChannel(oldChannelId!)) selectVoiceChannel(oldChannelId);
                        }, (Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay) * 1000);
                    }
                } else {
                    setReconnectFlag(true);
                }
            }
        }
    },
    updateShouldReconnect(value: boolean) {
        setReconnectFlag(value);
    }
});
