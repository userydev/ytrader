// Optional small Keychain alternative. The shipped TS client uses the maintained
// @aparajita/capacitor-secure-storage 8.0.1 plugin instead. Do not wire both stores.
import Foundation
import Capacitor
import Security

@objc(SessionVaultPlugin)
public class SessionVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SessionVaultPlugin"
    public let jsName = "SessionVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "app.ytrader.reader.session",
         kSecAttrAccount as String: "ytrader_session",
         kSecAttrSynchronizable as String: false]
    }
    @objc func load(_ call: CAPPluginCall) {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { call.resolve(["token": NSNull()]); return }
        guard status == errSecSuccess, let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            call.reject("Secure session read failed", "KEYCHAIN_READ_FAILED"); return
        }
        call.resolve(["token": token])
    }
    @objc func save(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty, token.utf8.count <= 256 else {
            call.reject("Invalid session", "INVALID_SESSION"); return
        }
        let attrs: [String: Any] = [kSecValueData as String: Data(token.utf8),
                                  kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var entry = query
            attrs.forEach { entry[$0.key] = $0.value }
            status = SecItemAdd(entry as CFDictionary, nil)
        }
        guard status == errSecSuccess else { call.reject("Secure session save failed", "KEYCHAIN_WRITE_FAILED"); return }
        call.resolve()
    }
    @objc func clear(_ call: CAPPluginCall) {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("Secure session removal failed", "KEYCHAIN_REMOVE_FAILED"); return
        }
        call.resolve()
    }
}
