import Foundation
import UserNotifications
import UIKit

final class NotificationService: NSObject, ObservableObject {
    static let shared = NotificationService()

    private let categoryID   = "TRAIN_DETECTED"
    private let actionOpenID = "OPEN_SETTINGS"

    private override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
        registerCategories()
    }

    func requestAuthorization(completion: ((Bool) -> Void)? = nil) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            completion?(granted)
        }
    }

    func sendTrainDetectedNotification() {
        let content = UNMutableNotificationContent()
        content.title = "🚃 電車乗車を検知しました"
        content.body  = "マナーのため機内モードをオンにしましょう。"
        content.sound = .default
        content.categoryIdentifier = categoryID

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 2, repeats: false)
        let request = UNNotificationRequest(
            identifier: "train-\(UUID().uuidString)",
            content: content,
            trigger: trigger
        )
        UNUserNotificationCenter.current().add(request)
    }

    func sendDepartedNotification() {
        let content = UNMutableNotificationContent()
        content.title = "🚉 下車を検知しました"
        content.body  = "機内モードを解除することをお忘れなく。"
        content.sound = .default

        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 2, repeats: false)
        let request = UNNotificationRequest(
            identifier: "depart-\(UUID().uuidString)",
            content: content,
            trigger: trigger
        )
        UNUserNotificationCenter.current().add(request)
    }

    private func registerCategories() {
        let openAction = UNNotificationAction(
            identifier: actionOpenID,
            title: "設定を開く",
            options: .foreground
        )
        let category = UNNotificationCategory(
            identifier: categoryID,
            actions: [openAction],
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }
}

extension NotificationService: UNUserNotificationCenterDelegate {
    // Show banner even when app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    // Handle "設定を開く" action
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if response.actionIdentifier == actionOpenID,
           let url = URL(string: UIApplication.openSettingsURLString) {
            DispatchQueue.main.async {
                UIApplication.shared.open(url)
            }
        }
        completionHandler()
    }
}
