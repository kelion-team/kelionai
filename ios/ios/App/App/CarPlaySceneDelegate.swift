import Foundation
import CarPlay
import WebKit

class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    
    var interfaceController: CPInterfaceController?
    
    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didConnect interfaceController: CPInterfaceController) {
        
        self.interfaceController = interfaceController
        
        let webView = WKWebView(frame: templateApplicationScene.carWindow.bounds)
        templateApplicationScene.carWindow.addSubview(webView)
        
        // Load your Capacitor app's index.html with a specific route for CarPlay
        // For example, loading from a local server during development
        // or the bundled index.html for production.
        // Ensure your Capacitor app routes '/car-mode' to the correct view.
        if let url = URL(string: "http://localhost:8100/car-mode") { // Adjust for production
             let request = URLRequest(url: url)
             webView.load(request)
        }
        
        // As a fallback or alternative, you can create a simple native interface
        let item = CPGridButton(title: "Welcome", image: UIImage(systemName: "star.fill")!) { _ in
            // Handle button tap
        }
        let gridTemplate = CPGridTemplate(title: "My App", gridButtons: [item])
        self.interfaceController?.setRootTemplate(gridTemplate, animated: true, completion: nil)
    }
    
    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didDisconnect interfaceController: CPInterfaceController) {
        self.interfaceController = nil
    }
}
