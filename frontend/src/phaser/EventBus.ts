import { Events } from "phaser";

/** Bridges React state/callbacks and the Phaser scene, same pattern as the official React template. */
export const EventBus = new Events.EventEmitter();
