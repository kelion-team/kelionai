import Capacitor
import Foundation
import Security
import UIKit

@objc(NativeSecureSession)
public class NativeSecureSession: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSecureSession"
    public let jsName = "NativeSecureSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "delete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAuthorize", returnType: CAPPluginReturnPromise),
    ]

    private func account(_ kind: String?) -> String? {
        switch kind {
        case "install-id": return "native-install-id-v1"
        case "access-token": return "native-access-token-v1"
        case "pending-auth": return "native-pending-auth-v1"
        case "pending-revocation": return "native-pending-revocation-v1"
        default: return nil
        }
    }

    private func query(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Bundle.main.bundleIdentifier ?? "",
            kSecAttrAccount as String: account,
        ]
    }

    @objc public func get(_ call: CAPPluginCall) {
        guard let account = account(call.getString("kind")) else {
            call.reject("secure_kind_invalid")
            return
        }
        var request = query(account)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject("secure_store_read_failed")
            return
        }
        call.resolve(["value": value])
    }

    @objc public func set(_ call: CAPPluginCall) {
        guard let account = account(call.getString("kind")),
              let value = call.getString("value"),
              !value.isEmpty,
              value.utf8.count <= 8_192,
              value.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value != 0x7F }) else {
            call.reject("secure_value_invalid")
            return
        }
        let data = Data(value.utf8)
        let base = query(account)
        let update = [kSecValueData as String: data]
        let updated = SecItemUpdate(base as CFDictionary, update as CFDictionary)
        if updated == errSecItemNotFound {
            var insert = base
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else {
                call.reject("secure_store_write_failed")
                return
            }
        } else if updated != errSecSuccess {
            call.reject("secure_store_write_failed")
            return
        }
        call.resolve()
    }

    @objc public func delete(_ call: CAPPluginCall) {
        guard let account = account(call.getString("kind")) else {
            call.reject("secure_kind_invalid")
            return
        }
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("secure_store_delete_failed")
            return
        }
        call.resolve()
    }

    @objc public func openAuthorize(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"),
              let url = URL(string: raw),
              let configured = Bundle.main.object(forInfoDictionaryKey: "KELIONPublicAppOrigin") as? String,
              let origin = URL(string: configured),
              url.scheme == "https",
              url.host?.lowercased() == origin.host?.lowercased(),
              url.port == origin.port,
              url.path == "/auth/native/authorize",
              url.fragment == nil,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.queryItems?.count == 1,
              components.queryItems?.first?.name == "request",
              !(components.queryItems?.first?.value ?? "").isEmpty else {
            call.reject("authorize_url_invalid")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                opened ? call.resolve() : call.reject("system_browser_unavailable")
            }
        }
    }
}
