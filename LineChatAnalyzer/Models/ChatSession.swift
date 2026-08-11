import Foundation
import SwiftData

@Model
final class ChatSession {
    var id: UUID
    var name: String
    var importDate: Date
    var rawContent: String
    var participantNames: [String]
    var messageCount: Int
    var startDate: Date?
    var endDate: Date?
    var summary: String?

    @Relationship(deleteRule: .cascade, inverse: \ChatMessage.session)
    var messages: [ChatMessage] = []

    init(
        name: String,
        rawContent: String,
        participantNames: [String],
        messageCount: Int,
        startDate: Date? = nil,
        endDate: Date? = nil
    ) {
        self.id = UUID()
        self.name = name
        self.importDate = Date()
        self.rawContent = rawContent
        self.participantNames = participantNames
        self.messageCount = messageCount
        self.startDate = startDate
        self.endDate = endDate
    }

    var dateRangeText: String {
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "ja_JP")
        fmt.dateStyle = .medium
        fmt.timeStyle = .none
        if let start = startDate, let end = endDate {
            if Calendar.current.isDate(start, inSameDayAs: end) {
                return fmt.string(from: start)
            }
            return "\(fmt.string(from: start)) 〜 \(fmt.string(from: end))"
        }
        return startDate.map { fmt.string(from: $0) } ?? ""
    }
}
