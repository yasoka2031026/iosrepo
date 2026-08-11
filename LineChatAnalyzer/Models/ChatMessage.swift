import Foundation
import SwiftData

@Model
final class ChatMessage {
    var id: UUID
    var timestamp: Date?
    var senderName: String
    var content: String
    var isSystem: Bool

    var session: ChatSession?

    init(timestamp: Date?, senderName: String, content: String, isSystem: Bool = false) {
        self.id = UUID()
        self.timestamp = timestamp
        self.senderName = senderName
        self.content = content
        self.isSystem = isSystem
    }

    var timeText: String {
        guard let ts = timestamp else { return "" }
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "ja_JP")
        fmt.dateFormat = "HH:mm"
        return fmt.string(from: ts)
    }

    var isSpecialContent: Bool {
        let specials = ["[写真]", "[スタンプ]", "[動画]", "[音声メッセージ]", "[ファイル]", "[GIF]", "[連絡先]", "[位置情報]"]
        return specials.contains(content)
    }
}
