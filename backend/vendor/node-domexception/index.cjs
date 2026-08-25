'use strict'

// fetch-blob still imports the retired node-domexception package even though
// every supported Kelion runtime already provides the standards-native class.
// Export that class directly; do not revive the deprecated worker-thread shim.
if (typeof globalThis.DOMException !== 'function') {
  throw new Error('native DOMException is required')
}

module.exports = globalThis.DOMException
