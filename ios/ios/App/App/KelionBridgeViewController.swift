import Capacitor
import UIKit

final class KelionBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativeSecureSession())
    }
}
