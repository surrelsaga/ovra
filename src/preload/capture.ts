// Preload for the hidden capture window: Ovra bridge + the SmartSpectra renderer bridge.
import { exposeBridge } from './bridge'
import '@smartspectra/node-sdk/preload'

exposeBridge({ allowCaptureSend: true })
