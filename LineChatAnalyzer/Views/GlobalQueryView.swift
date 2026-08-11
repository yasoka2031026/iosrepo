import SwiftUI
import SwiftData

/// 全セッション横断AI検索ビュー
/// HomeView のツールバーから起動し、インポート済みの全トークを並列に検索する。
struct GlobalQueryView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \ChatSession.importDate, order: .reverse) private var sessions: [ChatSession]
    @Query(sort: \AIQueryResult.createdAt, order: .reverse) private var allResults: [AIQueryResult]

    @State private var inputText = ""
    @State private var isLoading = false
    @State private var pendingQuestion = ""

    // 検索対象セッションの選択（デフォルト: 全選択）
    @State private var selectedSessionIDs: Set<UUID> = []
    @State private var showSessionPicker = false

    private var crossResults: [AIQueryResult] {
        allResults.filter { $0.isCrossSession }
    }

    private var targetSessions: [ChatSession] {
        if selectedSessionIDs.isEmpty { return sessions }
        return sessions.filter { selectedSessionIDs.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                VStack(spacing: 0) {
                    // 検索対象バナー
                    targetBanner

                    Divider().background(Theme.divider)

                    if sessions.isEmpty {
                        noSessionsView
                    } else {
                        ScrollViewReader { proxy in
                            ScrollView {
                                LazyVStack(spacing: 12) {
                                    if crossResults.isEmpty && !isLoading {
                                        emptyHintView
                                    }
                                    if isLoading {
                                        loadingCard.id("loading")
                                    }
                                    ForEach(crossResults) { result in
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
                }
            }
            .navigationTitle("横断検索")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { showSessionPicker = true }) {
                        Image(systemName: "slider.horizontal.3")
                            .foregroundStyle(Theme.accent)
                    }
                }
            }
            .sheet(isPresented: $showSessionPicker) {
                SessionPickerView(sessions: sessions, selectedIDs: $selectedSessionIDs)
            }
            .onAppear {
                // 初回は全セッション選択
                if selectedSessionIDs.isEmpty {
                    selectedSessionIDs = Set(sessions.map(\.id))
                }
            }
        }
    }

    // MARK: - Target Banner

    private var targetBanner: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.caption)
                    .foregroundStyle(Theme.accent)

                Text("検索対象:")
                    .font(Theme.fontCaption)
                    .foregroundStyle(Theme.textSecondary)

                if selectedSessionIDs.isEmpty || selectedSessionIDs.count == sessions.count {
                    sessionBadge("全\(sessions.count)件", isAll: true)
                } else {
                    ForEach(targetSessions.prefix(4)) { s in
                        sessionBadge(s.name, isAll: false)
                    }
                    if targetSessions.count > 4 {
                        sessionBadge("+\(targetSessions.count - 4)", isAll: false)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(Theme.surface)
    }

    private func sessionBadge(_ text: String, isAll: Bool) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(isAll ? .black : Theme.textSecondary)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(isAll ? Theme.accent : Theme.surfaceElevated)
            .clipShape(Capsule())
    }

    // MARK: - Empty States

    private var noSessionsView: some View {
        VStack(spacing: 16) {
            Image(systemName: "tray")
                .font(.system(size: 44))
                .foregroundStyle(Theme.textTertiary)
            Text("トーク履歴がありません")
                .font(Theme.fontHeadline)
                .foregroundStyle(Theme.textSecondary)
            Text("まずホーム画面からトークを読み込んでください")
                .font(Theme.fontBody)
                .foregroundStyle(Theme.textTertiary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var emptyHintView: some View {
        VStack(spacing: 20) {
            VStack(spacing: 8) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.system(size: 36))
                    .foregroundStyle(Theme.accent)
                Text("全トーク横断検索")
                    .font(Theme.fontHeadline)
                    .foregroundStyle(Theme.textSecondary)
                Text("複数のトークを並列検索し、\n「どのトーク・誰・いつ」の出典付きで回答します")
                    .font(Theme.fontCaption)
                    .foregroundStyle(Theme.textTertiary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 40)

            VStack(spacing: 8) {
                globalSuggestion("今月の予定や約束事を全トークからまとめて")
                globalSuggestion("〇〇について誰かが話していたのはどのトーク？")
                globalSuggestion("全トークを通じてよく話題になっていることは？")
                globalSuggestion("住所・電話番号などの連絡先情報を探して")
            }
        }
    }

    private func globalSuggestion(_ text: String) -> some View {
        Button(action: { inputText = text }) {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Theme.accent).font(.caption)
                Text(text)
                    .font(Theme.fontBody).foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "arrow.up.left")
                    .foregroundStyle(Theme.textTertiary).font(.caption2)
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
                    Text("\(targetSessions.count)件のトークを並列検索中...")
                        .font(Theme.fontBody).foregroundStyle(Theme.textSecondary)
                    Text(targetSessions.map(\.name).joined(separator: "、"))
                        .font(Theme.fontCaption).foregroundStyle(Theme.textTertiary).lineLimit(2)
                }
            }
        }
        .padding(14)
        .background(Theme.surfaceElevated)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Input Area

    private var inputArea: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("全トークを横断して質問...", text: $inputText, axis: .vertical)
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
        .padding(.vertical, 12)
        .background(Theme.background)
    }

    // MARK: - Actions

    private func sendQuery() {
        let question = inputText.trimmingCharacters(in: .whitespaces)
        guard !question.isEmpty else { return }

        inputText = ""
        isLoading = true
        pendingQuestion = question

        Task {
            do {
                let output = try await ClaudeAPIService.shared.queryCrossSessions(
                    question: question,
                    sessions: targetSessions
                )

                await MainActor.run {
                    let sources = output.usedSnapshots.prefix(30).map { $0.toSourceSnapshot() }
                    // 横断結果は sessionId を nil-substitute として最初のセッションの id を使用
                    let result = AIQueryResult(
                        query: question,
                        response: output.response,
                        sessionId: targetSessions.first?.id ?? UUID(),
                        searchedSessionNames: output.searchedSessionNames,
                        isCrossSession: true,
                        sources: Array(sources)
                    )
                    modelContext.insert(result)
                    try? modelContext.save()
                    isLoading = false
                    pendingQuestion = ""
                }
            } catch {
                await MainActor.run {
                    let result = AIQueryResult(
                        query: question,
                        response: "❌ \(error.localizedDescription)",
                        sessionId: targetSessions.first?.id ?? UUID(),
                        searchedSessionNames: targetSessions.map(\.name),
                        isCrossSession: true
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

// MARK: - SessionPickerView

struct SessionPickerView: View {
    let sessions: [ChatSession]
    @Binding var selectedIDs: Set<UUID>
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()
                List {
                    Section {
                        Button(action: toggleAll) {
                            Label(
                                selectedIDs.count == sessions.count ? "すべて解除" : "すべて選択",
                                systemImage: selectedIDs.count == sessions.count
                                    ? "checkmark.square.fill" : "square"
                            )
                            .foregroundStyle(Theme.accent)
                        }
                        .listRowBackground(Theme.surface)
                    }

                    Section("検索対象トーク") {
                        ForEach(sessions) { session in
                            Button(action: { toggleSession(session) }) {
                                HStack {
                                    Image(systemName: selectedIDs.contains(session.id)
                                          ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(selectedIDs.contains(session.id)
                                                         ? Theme.accent : Theme.textTertiary)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(session.name)
                                            .foregroundStyle(Theme.textPrimary)
                                            .font(Theme.fontBody)
                                        Text("\(session.messageCount)件・\(session.dateRangeText)")
                                            .font(Theme.fontCaption)
                                            .foregroundStyle(Theme.textTertiary)
                                    }
                                    Spacer()
                                }
                            }
                            .listRowBackground(Theme.surface)
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("検索対象を選択")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完了") { dismiss() }
                        .foregroundStyle(Theme.accent)
                }
            }
        }
    }

    private func toggleSession(_ session: ChatSession) {
        if selectedIDs.contains(session.id) {
            selectedIDs.remove(session.id)
        } else {
            selectedIDs.insert(session.id)
        }
    }

    private func toggleAll() {
        if selectedIDs.count == sessions.count {
            selectedIDs.removeAll()
        } else {
            selectedIDs = Set(sessions.map(\.id))
        }
    }
}
