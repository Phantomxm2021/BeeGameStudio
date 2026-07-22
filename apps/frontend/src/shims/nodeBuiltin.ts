// Browser-only placeholder for optional Node branches in Emscripten bundles.
// The guarded Node path is unreachable in the browser; providing an explicit
// module keeps Vite from emitting misleading externalization warnings.
const unavailableNodeBuiltin = Object.freeze({})

export default unavailableNodeBuiltin
