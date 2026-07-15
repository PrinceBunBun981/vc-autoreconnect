import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, makeRange } from "@utils/types";
import { ChannelType } from "@vencord/discord-types/enums";
import { VoiceState } from "@vencord/discord-types/src/stores";
import { findByPropsLazy } from "@webpack";
import { PermissionsBits } from "@webpack/common";
import { AuthenticationStore, ChannelStore, PermissionStore, UserStore } from "@webpack/common/stores";

const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");

let shouldReconnect: boolean = true;
let shouldReconnectToChannelId: string | null = null;

const settings = definePluginSettings({
    automaticallyReconnectOnDisconnects: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Whether to automatically reconnect to your last voice channel when disconnected."
    },
    automaticallyReconnectOnMoves: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Whether to automatically reconnect to your last voice channel when moved."
    },
    automaticallyReconnectWhenMovedToLockedChannels: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Whether to automatically reconnect to your last voice channel when moved to a channel you don't have permission to join."
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

function isDmChannel(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    return channel?.isDM() || channel?.isGroupDM() || channel?.isMultiUserDM();
}

function canJoinChannel(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);

    if (!channel) return false;
    if (channel.type != ChannelType.GUILD_VOICE) return false;

    return PermissionStore.can(PermissionsBits.CONNECT, channel);
}

function setReconnectFlag(value: boolean) {
    shouldReconnect = value;
}

function setReconnectToChannel(value: string | null) {
    if (value && !canJoinChannel(value)) return;
    shouldReconnectToChannelId = value;
}

export default definePlugin({
    name: "AutoReconnect",
    description: "Automatically reconnect to voice channels after a random delay when someone disconnects or moves you.",
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
        },
        {
            find: "this.selectVoiceChannel(null)",
            replacement: {
                match: /selectVoiceChannel\((\i)\){/,
                replace: "$&$self.updateShouldReconnectToChannel($1);"
            }
        },
        {
            find: "\"DRAGGABLE_USER\"",
            replacement: {
                match: /drop.{0,50}channel:(\i).{0,75};/,
                replace: "$&$self.updateShouldReconnectToChannel($1.id);"
            }
        }
    ],
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            if (!settings.store.automaticallyReconnectOnDisconnects && !settings.store.automaticallyReconnectOnMoves) return;

            const currentUserId = UserStore.getCurrentUser().id;

            for (const state of voiceStates) {
                const { userId, channelId, oldChannelId } = state;
                if (userId !== currentUserId) continue;

                if (state.sessionId !== AuthenticationStore.getSessionId()) continue;

                if (isDmChannel(channelId!)) return;

                let reconnectTo = shouldReconnectToChannelId ?? oldChannelId;
                if (!reconnectTo) return;

                if (settings.store.automaticallyReconnectWhenMovedToLockedChannels && !canJoinChannel(channelId!)) return;

                let reconnectOnDisconnect = (oldChannelId && !channelId) && settings.store.automaticallyReconnectOnDisconnects;
                let reconnectOnMove = (shouldReconnectToChannelId && channelId != shouldReconnectToChannelId) && settings.store.automaticallyReconnectOnMoves;

                // update the channel to reconnect to when moved while the setting to auto reconnect on moves is disabled
                if (!reconnectOnMove && channelId! != reconnectTo && canJoinChannel(channelId!)) setReconnectToChannel(channelId!);

                if (reconnectOnDisconnect || reconnectOnMove) {
                    if (shouldReconnect) {
                        const minDelay = Math.max(0.5, settings.store.minimumDelay);
                        const maxDelay = settings.store.maximumDelay;
                        setTimeout(() => {
                            if (canJoinChannel(reconnectTo!)) selectVoiceChannel(reconnectTo);
                        }, (Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay) * 1000);
                    }
                } else {
                    setReconnectFlag(true);
                }
            }
        }
    },
    updateShouldReconnect(value: boolean) {
        if (!value) setReconnectToChannel(null);
        setReconnectFlag(value);
    },
    updateShouldReconnectToChannel(value: string | null) {
        if (isDmChannel(value!)) {
            setReconnectFlag(false);
            setReconnectToChannel(null);
            return;
        }

        setReconnectToChannel(value);
    }
});
