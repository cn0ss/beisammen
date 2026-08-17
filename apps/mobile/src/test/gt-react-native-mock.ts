// Vitest stand-in for gt-react-native: the real package pulls in a native
// TurboModule that cannot load in Node. Re-export the pure primitives the
// tested modules use from gt-i18n, which gt-react-native wraps.
export { msg, decodeMsg } from 'gt-i18n';
