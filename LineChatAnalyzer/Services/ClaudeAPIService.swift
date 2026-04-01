import Foundation

enum ClaudeError: LocalizedError {
    case noAPIKey
    case networkError(String)
    case decodingError(String)
    case rateLimited
    case serverError(Int, String)

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
        }
    }
}

// Claude API リクエスト構造体
private struct ClaudeRequest: Encodable {
    let model: String
    let max_tokens: Int
    let system: String
    let messages: [Message]

    struct Message: Encodable {
        let role: String
        let content: String
    }
}

// Claude API レスポンス構造体
private struct ClaudeResponse: Decodable {
    let content: [Content]
    struct Content: Decodable {
        let text: String
    }
}

@Observable
final class ClaudeAPIService {
    static let shared = ClaudeAPIService()

    private let apiURL = URL(string: "https://api.anthropic.com/v1/messages")!
    // コスト最適化のため Haiku を使用
    private let model = "claude-haiku-4-5-20251001"

    var apiKey: String {
        get { UserDefaults.standard.string(forKey: "claude_api_key") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "claude_api_key") }
    }

    var isConfigured: Bool { !apiKey.isEmpty }

    // 質問に回答する
    func query(question: String, context: String) async throws -> String {
        guard !apiKey.isEmpty else { throw ClaudeError.noAPIKey }

        let system = """
        あなたはLINEトーク履歴を分析するAIアシスタントです。
        提供されたトーク内容に基づいて、ユーザーの質問に日本語で簡潔に回答してください。
        トーク内容に記載のない情報は推測せず、「記録がありません」と伝えてください。
        """

        let userMessage = """
        【トーク履歴】
        \(context)

        【質問】
        \(question)
        """

        return try await sendRequest(system: system, userMessage: userMessage, maxTokens: 1024)
    }

    // トーク全体をサマリーする
    func summarize(messages: [String]) async throws -> String {
        guard !apiKey.isEmpty else { throw ClaudeError.noAPIKey }

        // コスト削減のため最大200件に制限
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

    // キーワードで関連メッセージを抽出する（API不使用・無料）
    func searchRelevantMessages(in messages: [ChatMessage], for query: String) -> [ChatMessage] {
        let keywords = query
            .lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }

        guard !keywords.isEmpty else { return [] }

        return messages.filter { msg in
            let content = msg.content.lowercased()
            let sender = msg.senderName.lowercased()
            return keywords.contains { content.contains($0) || sender.contains($0) }
        }
    }

    // 送信コンテキストを文字数上限で構築する（古い順に詰める）
    func buildContext(from messages: [ChatMessage], maxChars: Int = 6000) -> String {
        var lines: [String] = []
        var totalChars = 0

        for msg in messages {
            let line = "\(msg.senderName): \(msg.content)"
            if totalChars + line.count + 1 > maxChars { break }
            lines.append(line)
            totalChars += line.count + 1
        }
        return lines.joined(separator: "\n")
    }

    // 内部: API リクエスト送信
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
        case 200:
            break
        case 429:
            throw ClaudeError.rateLimited
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
