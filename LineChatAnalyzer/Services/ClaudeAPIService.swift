import Foundation

// MARK: - Errors

enum ClaudeError: LocalizedError {
    case noAPIKey
    case networkError(String)
    case decodingError(String)
    case rateLimited
    case serverError(Int, String)
    case noRelevantContent

    var errorDescription: String? {
        switch self {
        case .noAPIKey:
            return "APIキーが設定されていません。設定タブから入力してください。"
        case .networkError(let msg):
            return "ネットワークエラー: \(msg)"
        case .decodingError(let msg):
            return "レスポンス解析エラー: \(msg)"
        case .rateLimited:
            return "APIの利用制限に達しました。しばらく待ってから再試行してください。"
        case .serverError(let code, let msg):
            return "サーバーエラー (\(code)): \(msg)"
        case .noRelevantContent:
            return "関連するメッセージが見つかりませんでした。キーワードを変えてみてください。"
        }
    }
}

// MARK: - MessageSnapshot (Sendable コピー)
// SwiftData の @Model は Sendable でないため、
// 非同期並列処理の前に値型へコピーして使用する。

struct MessageSnapshot: Sendable {
    let id: UUID
    let timestamp: Date?
    let senderName: String
    let content: String
    let sessionName: String

    init(from message: ChatMessage, sessionName: String) {
        self.id = message.id
        self.timestamp = message.timestamp
        self.senderName = message.senderName
        self.content = message.content
        self.sessionName = sessionName
    }

    // コンテキスト行フォーマット:
    //   [2024/01/15 12:30 | トーク名 | 田中太郎] こんにちは！
    var attributedLine: String {
        let dateStr: String
        if let ts = timestamp {
            let fmt = DateFormatter()
            fmt.locale = Locale(identifier: "ja_JP")
            fmt.dateFormat = "yyyy/MM/dd HH:mm"
            dateStr = fmt.string(from: ts)
        } else {
            dateStr = "日時不明"
        }
        return "[\(dateStr) | \(sessionName) | \(senderName)] \(content)"
    }

    func toSourceSnapshot() -> SourceSnapshot {
        SourceSnapshot(
            id: id,
            sessionName: sessionName,
            senderName: senderName,
            timestamp: timestamp,
            contentPreview: String(content.prefix(60))
        )
    }
}

// MARK: - API リクエスト / レスポンス

private struct ClaudeRequest: Encodable {
    let model: String
    let max_tokens: Int
    let system: String
    let messages: [Message]
    struct Message: Encodable { let role: String; let content: String }
}

private struct ClaudeResponse: Decodable {
    let content: [Content]
    struct Content: Decodable { let text: String }
}

// MARK: - QueryResult

struct QueryOutput {
    let response: String
    let usedSnapshots: [MessageSnapshot]
    let searchedSessionNames: [String]
    let isCrossSession: Bool
}

// MARK: - ClaudeAPIService

@Observable
final class ClaudeAPIService {
    static let shared = ClaudeAPIService()

    private let apiURL = URL(string: "https://api.anthropic.com/v1/messages")!
    private let model = "claude-haiku-4-5-20251001"   // コスト最適化

    var apiKey: String {
        get { UserDefaults.standard.string(forKey: "claude_api_key") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "claude_api_key") }
    }

    var isConfigured: Bool { !apiKey.isEmpty }

    // MARK: - 単一セッション質問

    func query(
        question: String,
        session: ChatSession,
        useFullContext: Bool = false
    ) async throws -> QueryOutput {
        guard !apiKey.isEmpty else { throw ClaudeError.noAPIKey }

        let sorted = session.messages.sorted {
            ($0.timestamp ?? .distantPast) < ($1.timestamp ?? .distantPast)
        }
        let snapshots = extractSnapshots(
            from: sorted,
            sessionName: session.name,
            question: question,
            useFullContext: useFullContext
        )
        guard !snapshots.isEmpty else { throw ClaudeError.noRelevantContent }

        let context = buildAttributedContext(from: snapshots, maxChars: 6000)
        let response = try await sendWithCitationInstruction(
            question: question,
            context: context,
            sessionNames: [session.name]
        )
        return QueryOutput(
            response: response,
            usedSnapshots: snapshots,
            searchedSessionNames: [session.name],
            isCrossSession: false
        )
    }

    // MARK: - 横断検索（全セッション並列）

    func queryCrossSessions(
        question: String,
        sessions: [ChatSession]
    ) async throws -> QueryOutput {
        guard !apiKey.isEmpty else { throw ClaudeError.noAPIKey }
        guard !sessions.isEmpty else { throw ClaudeError.noRelevantContent }

        // 1. SwiftData モデルを Sendable な値型へコピー（メインスレッドで行う）
        let sessionData: [(name: String, snapshots: [MessageSnapshot])] = sessions.map { s in
            let sorted = s.messages.sorted {
                ($0.timestamp ?? .distantPast) < ($1.timestamp ?? .distantPast)
            }
            let snaps = sorted.map { MessageSnapshot(from: $0, sessionName: s.name) }
            return (s.name, snaps)
        }

        // 2. 各セッションを並列にキーワード検索（純粋な値型操作なので Sendable 安全）
        typealias SessionBlock = (name: String, snapshots: [MessageSnapshot])
        let allBlocks: [SessionBlock] = await withTaskGroup(
            of: SessionBlock?.self
        ) { group in
            for (name, snapshots) in sessionData {
                group.addTask {
                    let relevant = Self.keywordSearch(in: snapshots, for: question)
                    let recent   = Array(snapshots.suffix(15))
                    var combined = relevant + recent
                    // 重複排除
                    var seen = Set<UUID>()
                    combined = combined.filter { seen.insert($0.id).inserted }
                    combined.sort { ($0.timestamp ?? .distantPast) < ($1.timestamp ?? .distantPast) }
                    guard !combined.isEmpty else { return nil }
                    return (name, combined)
                }
            }
            var results: [SessionBlock] = []
            for await block in group {
                if let b = block { results.append(b) }
            }
            return results.sorted { $0.name < $1.name } // 表示順を安定させる
        }

        guard !allBlocks.isEmpty else { throw ClaudeError.noRelevantContent }

        // 3. セッションごとにセクション分けしたコンテキストを構築
        let context = allBlocks.map { block in
            let sectionHeader = "━━━ 【トーク: \(block.name)】 ━━━"
            let body = buildAttributedContext(from: block.snapshots, maxChars: 2500)
            return "\(sectionHeader)\n\(body)"
        }.joined(separator: "\n\n")

        let sessionNames = allBlocks.map(\.name)
        let allSnapshots = allBlocks.flatMap(\.snapshots)

        // 4. Claude に送信
        let response = try await sendWithCitationInstruction(
            question: question,
            context: context,
            sessionNames: sessionNames
        )
        return QueryOutput(
            response: response,
            usedSnapshots: allSnapshots,
            searchedSessionNames: sessionNames,
            isCrossSession: true
        )
    }

    // MARK: - サマリー生成

    func summarize(messages: [String]) async throws -> String {
        guard !apiKey.isEmpty else { throw ClaudeError.noAPIKey }

        let sample = messages.prefix(200).joined(separator: "\n")
        let system = """
        あなたはLINEトーク履歴を分析するAIアシスタントです。
        日本語で、以下の形式でまとめてください：

        ## 概要
        （全体を2〜3文で）

        ## 主なトピック
        - （主要な話題を箇条書きで）

        ## キーポイント
        - （重要な情報・決定事項を箇条書きで）
        """
        return try await sendRequest(
            system: system,
            userMessage: "以下のトーク履歴をまとめてください：\n\n\(sample)",
            maxTokens: 1024
        )
    }

    // MARK: - Context Builders

    /// メッセージに出典メタデータを付与したコンテキスト文字列を生成する
    func buildAttributedContext(from snapshots: [MessageSnapshot], maxChars: Int = 6000) -> String {
        var lines: [String] = []
        var total = 0
        for snap in snapshots {
            let line = snap.attributedLine
            if total + line.count + 1 > maxChars { break }
            lines.append(line)
            total += line.count + 1
        }
        return lines.joined(separator: "\n")
    }

    /// キーワード検索（値型 MessageSnapshot 版 — スレッドセーフ）
    static func keywordSearch(in snapshots: [MessageSnapshot], for query: String) -> [MessageSnapshot] {
        let keywords = query
            .lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
        guard !keywords.isEmpty else { return [] }
        return snapshots.filter { snap in
            let c = snap.content.lowercased()
            let s = snap.senderName.lowercased()
            return keywords.contains { c.contains($0) || s.contains($0) }
        }
    }

    /// @Model ChatMessage 版キーワード検索（単一セッション用）
    func searchRelevantMessages(in messages: [ChatMessage], for query: String) -> [ChatMessage] {
        let keywords = query
            .lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
        guard !keywords.isEmpty else { return [] }
        return messages.filter { msg in
            let c = msg.content.lowercased()
            let s = msg.senderName.lowercased()
            return keywords.contains { c.contains($0) || s.contains($0) }
        }
    }

    // MARK: - Private Helpers

    private func extractSnapshots(
        from messages: [ChatMessage],
        sessionName: String,
        question: String,
        useFullContext: Bool
    ) -> [MessageSnapshot] {
        if useFullContext {
            return messages.map { MessageSnapshot(from: $0, sessionName: sessionName) }
        }
        let relevant = searchRelevantMessages(in: messages, for: question)
        let recent   = Array(messages.suffix(50))
        var combined = relevant + recent
        var seen = Set<UUID>()
        combined = combined.filter { seen.insert($0.id).inserted }
        combined.sort { ($0.timestamp ?? .distantPast) < ($1.timestamp ?? .distantPast) }
        return combined.map { MessageSnapshot(from: $0, sessionName: sessionName) }
    }

    /// 出典引用を促すシステムプロンプト付きで Claude に送信する
    private func sendWithCitationInstruction(
        question: String,
        context: String,
        sessionNames: [String]
    ) async throws -> String {
        let isCross = sessionNames.count > 1
        let scopeDesc = isCross
            ? "複数のLINEトーク（\(sessionNames.joined(separator: "・"))）"
            : "LINEトーク「\(sessionNames.first ?? "")」"

        let system = """
        あなたは\(scopeDesc)の履歴を分析するAIアシスタントです。

        【回答ルール】
        1. 提供されたトーク内容のみを根拠にして回答してください。
        2. 情報の出典として「トーク名・送信者・日付」を回答中に必ず明記してください。
           例：（\(sessionNames.first ?? "トーク名") / 田中太郎 / 2024年1月15日）
        3. 複数のトークにまたがる場合は、トークごとに情報を整理して提示してください。
        4. トーク内容に記載のない情報は推測せず「記録なし」と明記してください。
        5. 日本語で回答してください。
        """

        let userMessage = """
        【トーク履歴】
        \(context)

        【質問】
        \(question)
        """

        return try await sendRequest(system: system, userMessage: userMessage, maxTokens: 1500)
    }

    private func sendRequest(system: String, userMessage: String, maxTokens: Int) async throws -> String {
        let body = ClaudeRequest(
            model: model,
            max_tokens: maxTokens,
            system: system,
            messages: [.init(role: "user", content: userMessage)]
        )

        var request = URLRequest(url: apiURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw ClaudeError.networkError(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw ClaudeError.networkError("レスポンスが不正です")
        }

        switch http.statusCode {
        case 200: break
        case 429: throw ClaudeError.rateLimited
        default:
            let msg = String(data: data, encoding: .utf8) ?? "不明なエラー"
            throw ClaudeError.serverError(http.statusCode, msg)
        }

        do {
            let decoded = try JSONDecoder().decode(ClaudeResponse.self, from: data)
            return decoded.content.first?.text ?? ""
        } catch {
            throw ClaudeError.decodingError(error.localizedDescription)
        }
    }
}
