interface ProductBuildConfig {
  appName: string
  appVersion: string
  publicAppOrigin: string
  githubRepository: string
  supportEmail: string
  nativeScheme: string
  nativeOrigins: string[]
  nativeRedirects: { ios: string; desktop: string }
  androidApplicationId: string
  androidVersionCode: number
  androidCertificateSha256: string[]
  iosBundleId: string
  iosTeamId: string
  desktopBundleId: string
}

declare const __PRODUCT_CONFIG__: ProductBuildConfig

const publicUrl = new URL(__PRODUCT_CONFIG__.publicAppOrigin)

export const productConfig = Object.freeze({
  ...__PRODUCT_CONFIG__,
  publicAppHost: publicUrl.host,
})
