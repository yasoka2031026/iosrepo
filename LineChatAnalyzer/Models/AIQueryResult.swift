import Foundation
import SwiftData

@Model
final class AIQueryResult {
    var id: UUID
    var query: String
    var response: String
    var sessionId: UUID
    var createdAt: Date

    init(query: String, response: String, sessionId: UUID) {
        self.id = UUID()
        self.query = query
        self.response = response
        self.sessionId = sessionId
        self.createdAt = Date()
    }
}
