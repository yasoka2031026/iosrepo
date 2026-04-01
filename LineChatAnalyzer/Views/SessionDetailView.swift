import SwiftUI
import SwiftData

struct SessionDetailView: View {
    let session: ChatSession

    @State private var selectedTab = 0

    private let tabs = ["メッセージ", "AI質問", "サマリー"]

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // カスタムタブバー
                tabBar

                Divider().background(Theme.divider)

                // コンテンツ
                TabView(selection: $selectedTab) {
                    MessagesTab(session: session)
                        .tag(0)
                    QueryView(session: session)
                        .tag(1)
                    SummaryTab(session: session)
                        .tag(2)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.easeInOut(duration: 0.2), value: selectedTab)
            }
        }
        .navigationTitle(session.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(tabs.indices, id: \.self) { i in
                Button(action: { withAnimation { selectedTab = i } }) {
                    VStack(spacing: 6) {
                        Text(tabs[i])
                            .font(selectedTab == i ? Theme.fontHeadline : Theme.fontBody)
                            .foregroundStyle(selectedTab == i ? Theme.accent : Theme.textSecondary)
                        Rectangle()
                            .fill(selectedTab == i ? Theme.accent : Color.clear)
                            .frame(height: 2)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10)
                }
            }
        }
        .background(Theme.surface)
    }
}

// MARK: - Messages Tab

struct MessagesTab: View {
    let session: ChatSession

    @State private var searchText = ""

    private var sortedMessages: [ChatMessage] {
        session.messages.sorted {
            ($0.timestamp ?? .distantPast) < ($1.timestamp ?? .distantPast)
        }
    }

    private var displayMessages: [ChatMessage] {
        guard !searchText.isEmpty else { return sortedMessages }
        return sortedMessages.filter {
            $0.content.localizedCaseInsensitiveContains(searchText) ||
            $0.senderName.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // 検索バー
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Theme.textTertiary)
                TextField("メッセージ・送信者を検索", text: $searchText)
                    .font(Theme.fontBody)
                    .foregroundStyle(Theme.textPrimary)
                if !searchText.isEmpty {
                    Button(action: { searchText = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Theme.textTertiary)
                    }
                }
            }
            .padding(10)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Theme.background)

            if !searchText.isEmpty {
                Text("\(displayMessages.count) 件の結果")
                    .font(Theme.fontCaption)
                    .foregroundStyle(Theme.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 4)
            }

            Divider().background(Theme.divider)

            if displayMessages.isEmpty {
                Spacer()
                Text(searchText.isEmpty ? "メッセージがありません" : "一致するメッセージが見つかりません")
                    .font(Theme.fontBody)
                    .foregroundStyle(Theme.textTertiary)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 0, pinnedViews: []) {
                        ForEach(displayMessages) { msg in
                            MessageRow(message: msg, searchText: searchText)
                            Divider()
                                .background(Theme.divider)
                                .padding(.leading, 16)
                        }
                    }
                }
            }
        }
        .background(Theme.background)
    }
}

// MARK: - Summary Tab

struct SummaryTab: View {
    let session: ChatSession

    @State private var summary = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                statsCard
                summaryCard
            }
            .padding(16)
        }
        .background(Theme.background)
        .onAppear {
            if let cached = session.summary, !cached.isEmpty {
                summary = cached
            }
        }
    }

    // MARK: 統計カード

    private var statsCard: some View {
        VStack(spacing: 14) {
            HStack {
                statItem(icon: "message.fill",   value: "\(session.messageCount)", label: "メッセージ")
                Divider().frame(height: 44).background(Theme.divider)
                statItem(icon: "person.2.fill",  value: "\(session.participantNames.count)", label: "参加者")
            }

            if !session.dateRangeText.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "calendar").foregroundStyle(Theme.accent)
                    Text(session.dateRangeText)
                        .font(Theme.fontBody)
                        .foregroundStyle(Theme.textSecondary)
                }
            }

            if !session.participantNames.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(session.participantNames, id: \.self) { name in
                        Text(name)
                            .font(Theme.fontCaption)
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Theme.surfaceElevated)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .padding(16)
        .cardStyle()
    }

    private func statItem(icon: String, value: String, label: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).foregroundStyle(Theme.accent)
            Text(value).font(Theme.fontHeadline).foregroundStyle(Theme.textPrimary)
            Text(label).font(Theme.fontCaption).foregroundStyle(Theme.textTertiary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: AIサマリーカード

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("AI サマリー", systemImage: "sparkles")
                    .font(Theme.fontHeadline)
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                if !summary.isEmpty {
                    Button(action: generateSummary) {
                        Image(systemName: "arrow.clockwise")
                            .foregroundStyle(Theme.textTertiary)
                            .font(.caption)
                    }
                    .disabled(isLoading)
                }
            }

            if let err = errorMessage {
                Text(err)
                    .font(Theme.fontBody)
                    .foregroundStyle(Theme.destructive)
            } else if isLoading {
                HStack(spacing: 8) {
                    ProgressView().tint(Theme.accent)
                    Text("生成中...").font(Theme.fontBody).foregroundStyle(Theme.textSecondary)
                }
            } else if summary.isEmpty {
                Button(action: generateSummary) {
                    Label("サマリーを生成する", systemImage: "sparkles")
                        .font(Theme.fontHeadline)
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Theme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                Text("※ Claude Haiku API を使用します（低コスト）")
                    .font(Theme.fontCaption)
                    .foregroundStyle(Theme.textTertiary)
            } else {
                Text(summary)
                    .font(Theme.fontBody)
                    .foregroundStyle(Theme.textPrimary)
                    .textSelection(.enabled)
            }
        }
        .padding(16)
        .cardStyle()
    }

    private func generateSummary() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                let msgs = session.messages
                    .sorted { ($0.timestamp ?? .distantPast) < ($1.timestamp ?? .distantPast) }
                    .map { "\($0.senderName): \($0.content)" }

                let result = try await ClaudeAPIService.shared.summarize(messages: msgs)

                await MainActor.run {
                    summary = result
                    session.summary = result
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }
}
