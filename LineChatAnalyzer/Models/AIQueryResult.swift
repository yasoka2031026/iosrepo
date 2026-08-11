import Foundation
import SwiftData

@Model
final class AIQueryResult {
    var id: UUID
    var query: String
    var response: String
    var sessionId: UUID
    var createdAt: Date

    // 出典情報（SwiftData 軽量マイグレーション対応のためデフォルト値付き）
    var searchedSessionNames: [String] = []
    var isCrossSession: Bool = false
    // 検索にヒットしたメッセージのスナップショット（出典表示用）
    var sourceSnapshotsData: Data = Data()

    init(
        query: String,
        response: String,
        sessionId: UUID,
        searchedSessionNames: [String] = [],
        isCrossSession: Bool = false,
        sources: [SourceSnapshot] = []
    ) {
        self.id = UUID()
        self.query = query
        self.response = response
        self.sessionId = sessionId
        self.createdAt = Date()
        self.searchedSessionNames = searchedSessionNames
        self.isCrossSession = isCrossSession
        self.sourceSnapshotsData = (try? JSONEncoder().encode(sources)) ?? Data()
    }

    var sources: [SourceSnapshot] {
        (try? JSONDecoder().decode([SourceSnapshot].self, from: sourceSnapshotsData)) ?? []
    }
}

// 出典スナップショット（どのトーク・誰・いつ）
struct SourceSnapshot: Codable, Identifiable {
    let id: UUID
    let sessionName: String
    let senderName: String
    let timestamp: Date?
    let contentPreview: String   // 先頭 60 文字

    var dateText: String {
        guard let ts = timestamp else { return "日時不明" }
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "ja_JP")
        fmt.dateFormat = "yyyy年M月d日 HH:mm"
        return fmt.string(from: ts)
    }
}
