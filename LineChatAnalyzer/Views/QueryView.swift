import SwiftUI
import SwiftData

struct QueryView: View {
    let session: ChatSession

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \AIQueryResult.createdAt, order: .reverse) private var allResults: [AIQueryResult]
    @Query(sort: \ChatSession.importDate, order: .reverse) private var allSessions: [ChatSession]

    @State private var inputText = ""
    @State private var isLoading = false
    @State private var pendingQuestion = ""
    @State private var errorMessage: String?
    @State private var useFullContext = false
    @State private var crossSessionMode = false

    private var sessionResults: [AIQueryResult] {
        allResults.filter { $0.sessionId == session.id }
    }

    var body: some View {
        VStack(spacing: 0) {
            if !ClaudeAPIService.shared.isConfigured {
                apiKeyBanner
            }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if sessionResults.isEmpty && !isLoading {
                            suggestionsView
                        }
                        if isLoading {
                            loadingCard
                                .id("loading")
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
                        withAnimation { proxy.scrollTo("loading", anchor: .top) }
                    }
                }
            }

            Divider().background(Theme.divider)
            inputArea
        }
        .background(Theme.background)
    }

    // MARK: - API Key Banner

    private var apiKeyBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "key.fill").foregroundStyle(Theme.warning)
            Text("設定タブで Claude API キーを設定してください")
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
            VStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 36))
                    .foregroundStyle(Theme.accent)
                Text("AIに質問する")
                    .font(Theme.fontHeadline)
                    .foregroundStyle(Theme.textSecondary)
                Text("回答には「どのトーク・誰・いつ」の出典が付きます")
                    .font(Theme.fontCaption)
                    .foregroundStyle(Theme.textTertiary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 40)

            VStack(spacing: 8) {
                suggestion("このトークの主なトピックは？")
                suggestion("誰が一番多くメッセージを送っていた？")
                suggestion("重要な決定事項をまとめて")
                suggestion("〇〇についていつ、誰が話したか教えて")
            }
        }
    }

    private func suggestion(_ text: String) -> some View {
        Button(action: { inputText = text }) {
            HStack {
                Image(systemName: "lightbulb").foregroundStyle(Theme.accent).font(.caption)
                Text(text).font(Theme.fontBody).foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "arrow.up.left").foregroundStyle(Theme.textTertiary).font(.caption2)
            }
            .padding(.horizontal, 14).padding(.vertical, 10).cardStyle()
        }
    }

    // MARK: - Loading Card

    private var loadingCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !pendingQuestion.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "person.circle.fill").foregroundStyle(Theme.textTertiary)
                    Text(pendingQuestion)
                        .font(Theme.fontBody).foregroundStyle(Theme.textPrimary).fontWeight(.medium)
                }
            }
            Divider().background(Theme.divider)
            HStack(spacing: 10) {
                ProgressView().progressViewStyle(.circular).scaleEffect(0.8).tint(Theme.accent)
                VStack(alignment: .leading, spacing: 4) {
                    Text(crossSessionMode ? "全\(allSessions.count)件のトークを並列検索中..." : "検索・推論中...")
                        .font(Theme.fontBody).foregroundStyle(Theme.textSecondary)
                    if crossSessionMode {
                        Text(allSessions.map(\.name).joined(separator: "、"))
                            .font(Theme.fontCaption).foregroundStyle(Theme.textTertiary)
                            .lineLimit(2)
                    }
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
            // モード切替
            HStack(spacing: 16) {
                // 全コンテキスト（単一セッションモードのみ表示）
                if !crossSessionMode {
                    Toggle(isOn: $useFullContext) {
                        Label("全履歴", systemImage: "doc.text")
                            .font(Theme.fontCaption)
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .tint(Theme.accent)
                }

                Spacer()

                // 横断検索トグル
                Button(action: { withAnimation { crossSessionMode.toggle() } }) {
                    HStack(spacing: 5) {
                        Image(systemName: crossSessionMode
                              ? "arrow.triangle.branch"
                              : "arrow.triangle.branch")
                            .font(.caption)
                        Text(crossSessionMode ? "横断: ON" : "横断: OFF")
                            .font(Theme.fontCaption)
                    }
                    .foregroundStyle(crossSessionMode ? .black : Theme.textTertiary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(crossSessionMode ? Theme.accent : Theme.surfaceElevated)
                    .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 16)

            if crossSessionMode {
                HStack(spacing: 6) {
                    Image(systemName: "info.circle")
                        .font(.caption)
                        .foregroundStyle(Theme.accent)
                    Text("全\(allSessions.count)件のトークを横断して検索します")
                        .font(Theme.fontCaption)
                        .foregroundStyle(Theme.textTertiary)
                    Spacer()
                }
                .padding(.horizontal, 16)
            }

            HStack(alignment: .bottom, spacing: 10) {
                TextField("質問を入力...", text: $inputText, axis: .vertical)
                    .font(Theme.fontBody)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 14).padding(.vertical, 10)
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

    // MARK: - Send Query

    private func sendQuery() {
        let question = inputText.trimmingCharacters(in: .whitespaces)
        guard !question.isEmpty else { return }

        inputText = ""
        isLoading = true
        pendingQuestion = question
        errorMessage = nil

        Task {
            do {
                let output: QueryOutput
                if crossSessionMode {
                    output = try await ClaudeAPIService.shared.queryCrossSessions(
                        question: question,
                        sessions: allSessions
                    )
                } else {
                    output = try await ClaudeAPIService.shared.query(
                        question: question,
                        session: session,
                        useFullContext: useFullContext
                    )
                }

                await MainActor.run {
                    let sources = output.usedSnapshots.prefix(20).map { $0.toSourceSnapshot() }
                    let result = AIQueryResult(
                        query: question,
                        response: output.response,
                        sessionId: session.id,
                        searchedSessionNames: output.searchedSessionNames,
                        isCrossSession: output.isCrossSession,
                        sources: Array(sources)
                    )
                    modelContext.insert(result)
                    try? modelContext.save()
                    isLoading = false
                    pendingQuestion = ""
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    // エラーをダミー結果として保存（表示のため）
                    let result = AIQueryResult(
                        query: question,
                        response: "❌ \(error.localizedDescription)",
                        sessionId: session.id
                    )
                    modelContext.insert(result)
                    try? modelContext.save()
                    isLoading = false
                    pendingQuestion = ""
                }
            }
        }
    }

    private func deleteResult(_ result: AIQueryResult) {
        modelContext.delete(result)
        try? modelContext.save()
    }
}

// MARK: - QueryResultCard

struct QueryResultCard: View {
    let result: AIQueryResult
    let onDelete: () -> Void

    @State private var isAnswerExpanded = false
    @State private var isSourcesExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {

            // ─── ヘッダー（質問 + モードバッジ）─────────────────────────
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    Image(systemName: "person.circle.fill").foregroundStyle(Theme.textTertiary)
                    Text(result.query)
                        .font(Theme.fontBody).foregroundStyle(Theme.textPrimary).fontWeight(.medium)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(result.createdAt, style: .date)
                        .font(Theme.fontCaption).foregroundStyle(Theme.textTertiary)
                }

                // バッジ行（横断 or セッション名）
                HStack(spacing: 6) {
                    if result.isCrossSession {
                        badgePill("横断検索", color: Theme.accent)
                    }
                    ForEach(result.searchedSessionNames.prefix(3), id: \.self) { name in
                        badgePill(name, color: Theme.surfaceElevated, textColor: Theme.textTertiary)
                    }
                    if result.searchedSessionNames.count > 3 {
                        badgePill("+\(result.searchedSessionNames.count - 3)", color: Theme.surfaceElevated, textColor: Theme.textTertiary)
                    }
                }
            }
            .padding(14)

            Divider().background(Theme.divider)

            // ─── 回答 ────────────────────────────────────────────────────
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "sparkles").foregroundStyle(Theme.accent)
                    VStack(alignment: .leading, spacing: 6) {
                        let preview = result.response.prefix(300)
                        Text(isAnswerExpanded ? result.response : String(preview))
                            .font(Theme.fontBody).foregroundStyle(Theme.textSecondary)
                            .textSelection(.enabled)
                        if result.response.count > 300 {
                            Button(action: { withAnimation { isAnswerExpanded.toggle() } }) {
                                Text(isAnswerExpanded ? "折りたたむ ▲" : "続きを読む ▼")
                                    .font(Theme.fontCaption).foregroundStyle(Theme.accent)
                            }
                        }
                    }
                }
            }
            .padding(14)

            // ─── 出典情報（折りたたみ）────────────────────────────────────
            if !result.sources.isEmpty {
                Divider().background(Theme.divider)
                sourceSection
            }
        }
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .swipeActions(edge: .trailing) {
            Button(role: .destructive, action: onDelete) {
                Label("削除", systemImage: "trash")
            }
        }
    }

    // 出典セクション
    private var sourceSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: { withAnimation(.easeInOut(duration: 0.2)) { isSourcesExpanded.toggle() } }) {
                HStack(spacing: 6) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.caption).foregroundStyle(Theme.textTertiary)
                    Text("参照した\(result.sources.count)件のメッセージ")
                        .font(Theme.fontCaption).foregroundStyle(Theme.textTertiary)
                    Spacer()
                    Image(systemName: isSourcesExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2).foregroundStyle(Theme.textTertiary)
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
            }

            if isSourcesExpanded {
                Divider().background(Theme.divider)
                VStack(spacing: 0) {
                    ForEach(result.sources) { source in
                        SourceRow(source: source)
                        if source.id != result.sources.last?.id {
                            Divider().background(Theme.divider).padding(.leading, 14)
                        }
                    }
                }
            }
        }
    }

    private func badgePill(_ text: String, color: Color, textColor: Color = .black) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(textColor)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color)
            .clipShape(Capsule())
    }
}

// MARK: - SourceRow（出典1件）

struct SourceRow: View {
    let source: SourceSnapshot

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Rectangle()
                .fill(Theme.accent)
                .frame(width: 3)
                .clipShape(Capsule())

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    // トーク名
                    Text(source.sessionName)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                        .lineLimit(1)

                    Text("／")
                        .font(Theme.fontCaption)
                        .foregroundStyle(Theme.textTertiary)

                    // 送信者
                    Text(source.senderName)
                        .font(Theme.fontCaption)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)

                    Spacer()

                    // 日時
                    Text(source.dateText)
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.textTertiary)
                        .lineLimit(1)
                }

                // メッセージプレビュー
                Text(source.contentPreview)
                    .font(Theme.fontCaption)
                    .foregroundStyle(Theme.textTertiary)
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(Theme.background)
    }
}
