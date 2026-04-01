import SwiftUI
import SwiftData

struct QueryView: View {
    let session: ChatSession

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \AIQueryResult.createdAt, order: .reverse) private var allResults: [AIQueryResult]

    @State private var inputText = ""
    @State private var isLoading = false
    @State private var currentAnswer = ""
    @State private var currentQuestion = ""
    @State private var errorMessage: String?
    @State private var useFullContext = false

    private var sessionResults: [AIQueryResult] {
        allResults.filter { $0.sessionId == session.id }
    }

    var body: some View {
        VStack(spacing: 0) {
            // APIキー未設定バナー
            if !ClaudeAPIService.shared.isConfigured {
                apiKeyBanner
            }

            // 質問履歴 + 現在の回答
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if sessionResults.isEmpty && !isLoading && currentAnswer.isEmpty {
                            suggestionsView
                        }

                        if isLoading || !currentAnswer.isEmpty {
                            currentAnswerCard
                                .id("current")
                        }

                        ForEach(sessionResults) { result in
                            QueryResultCard(result: result) {
                                deleteResult(result)
                            }
                        }
                    }
                    .padding(16)
                }
                .onChange(of: isLoading) { _, loading in
                    if loading {
                        withAnimation { proxy.scrollTo("current", anchor: .top) }
                    }
                }
            }

            Divider().background(Theme.divider)

            // 入力エリア
            inputArea
        }
        .background(Theme.background)
    }

    // MARK: - API Key Banner

    private var apiKeyBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "key.fill")
                .foregroundStyle(Theme.warning)
            Text("設定タブでClaude APIキーを設定してください")
                .font(Theme.fontCaption)
                .foregroundStyle(Theme.warning)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Theme.warning.opacity(0.1))
    }

    // MARK: - Suggestions

    private var suggestionsView: some View {
        VStack(spacing: 20) {
            VStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.system(size: 36))
                    .foregroundStyle(Theme.accent)
                Text("AIに質問する")
                    .font(Theme.fontHeadline)
                    .foregroundStyle(Theme.textSecondary)
                Text("トーク内容に関する質問を入力してください")
                    .font(Theme.fontCaption)
                    .foregroundStyle(Theme.textTertiary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 40)

            VStack(spacing: 8) {
                suggestion("このトークの主なトピックは？")
                suggestion("誰が一番多くメッセージを送っていた？")
                suggestion("重要な決定事項をまとめて")
                suggestion("〇〇について話した内容を教えて")
            }
        }
    }

    private func suggestion(_ text: String) -> some View {
        Button(action: { inputText = text }) {
            HStack {
                Image(systemName: "lightbulb")
                    .foregroundStyle(Theme.accent)
                    .font(.caption)
                Text(text)
                    .font(Theme.fontBody)
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "arrow.up.left")
                    .foregroundStyle(Theme.textTertiary)
                    .font(.caption2)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .cardStyle()
        }
    }

    // MARK: - Current Answer Card

    private var currentAnswerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            // 質問
            if !currentQuestion.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "person.circle.fill")
                        .foregroundStyle(Theme.textTertiary)
                    Text(currentQuestion)
                        .font(Theme.fontBody)
                        .foregroundStyle(Theme.textPrimary)
                        .fontWeight(.medium)
                }
            }

            Divider().background(Theme.divider)

            // 回答
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "sparkles")
                    .foregroundStyle(Theme.accent)

                if isLoading && currentAnswer.isEmpty {
                    HStack(spacing: 6) {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .scaleEffect(0.8)
                            .tint(Theme.accent)
                        Text("考え中...")
                            .font(Theme.fontBody)
                            .foregroundStyle(Theme.textSecondary)
                    }
                } else if let err = errorMessage {
                    Text(err)
                        .font(Theme.fontBody)
                        .foregroundStyle(Theme.destructive)
                } else {
                    Text(currentAnswer)
                        .font(Theme.fontBody)
                        .foregroundStyle(Theme.textSecondary)
                        .textSelection(.enabled)
                }
            }
        }
        .padding(14)
        .background(Theme.surfaceElevated)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Input Area

    private var inputArea: some View {
        VStack(spacing: 10) {
            HStack {
                Toggle(isOn: $useFullContext) {
                    Label("全履歴を使用（コスト高）", systemImage: "doc.text")
                        .font(Theme.fontCaption)
                        .foregroundStyle(Theme.textTertiary)
                }
                .tint(Theme.accent)
            }
            .padding(.horizontal, 16)

            HStack(alignment: .bottom, spacing: 10) {
                TextField("質問を入力...", text: $inputText, axis: .vertical)
                    .font(Theme.fontBody)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .lineLimit(1...5)

                Button(action: sendQuery) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(
                            (inputText.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
                            ? Theme.textTertiary : Theme.accent
                        )
                }
                .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
        .background(Theme.background)
    }

    // MARK: - Actions

    private func sendQuery() {
        let question = inputText.trimmingCharacters(in: .whitespaces)
        guard !question.isEmpty else { return }

        inputText = ""
        isLoading = true
        currentQuestion = question
        currentAnswer = ""
        errorMessage = nil

        Task {
            do {
                let service = ClaudeAPIService.shared
                let sorted = session.messages.sorted {
                    ($0.timestamp ?? .distantPast) < ($1.timestamp ?? .distantPast)
                }

                let context: String
                if useFullContext {
                    context = sorted.map { "\($0.senderName): \($0.content)" }.joined(separator: "\n")
                } else {
                    let relevant = service.searchRelevantMessages(in: sorted, for: question)
                    let recent = Array(sorted.suffix(50))
                    let combined = (relevant + recent)
                        .uniqued()
                        .sorted { ($0.timestamp ?? .distantPast) < ($1.timestamp ?? .distantPast) }
                    context = service.buildContext(from: combined)
                }

                let answer = try await service.query(question: question, context: context)

                await MainActor.run {
                    currentAnswer = answer
                    isLoading = false
                    let result = AIQueryResult(query: question, response: answer, sessionId: session.id)
                    modelContext.insert(result)
                    try? modelContext.save()
                    // 少し待ってからクリア（ユーザーが読めるように）
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        currentAnswer = ""
                        currentQuestion = ""
                    }
                }

            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }

    private func deleteResult(_ result: AIQueryResult) {
        modelContext.delete(result)
        try? modelContext.save()
    }
}

// MARK: - Query Result Card

struct QueryResultCard: View {
    let result: AIQueryResult
    let onDelete: () -> Void
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // 質問
            HStack(alignment: .top) {
                Image(systemName: "person.circle.fill")
                    .foregroundStyle(Theme.textTertiary)
                Text(result.query)
                    .font(Theme.fontBody)
                    .foregroundStyle(Theme.textPrimary)
                    .fontWeight(.medium)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(result.createdAt, style: .date)
                    .font(Theme.fontCaption)
                    .foregroundStyle(Theme.textTertiary)
            }

            Divider().background(Theme.divider)

            // 回答
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "sparkles")
                    .foregroundStyle(Theme.accent)

                VStack(alignment: .leading, spacing: 6) {
                    let preview = result.response.prefix(200)
                    Text(isExpanded ? result.response : String(preview))
                        .font(Theme.fontBody)
                        .foregroundStyle(Theme.textSecondary)
                        .textSelection(.enabled)

                    if result.response.count > 200 {
                        Button(action: { withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() } }) {
                            Text(isExpanded ? "折りたたむ ▲" : "続きを読む ▼")
                                .font(Theme.fontCaption)
                                .foregroundStyle(Theme.accent)
                        }
                    }
                }
            }
        }
        .padding(14)
        .cardStyle()
        .swipeActions(edge: .trailing) {
            Button(role: .destructive, action: onDelete) {
                Label("削除", systemImage: "trash")
            }
        }
    }
}

// MARK: - Array uniqued helper

extension Array where Element: Identifiable {
    func uniqued() -> [Element] {
        var seen = Set<AnyHashable>()
        return filter { seen.insert($0.id as AnyObject).inserted }
    }
}
