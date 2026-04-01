import SwiftUI
import SwiftData

struct HomeView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \ChatSession.importDate, order: .reverse) private var sessions: [ChatSession]

    @State private var showImport = false
    @State private var searchText = ""
    @State private var sessionToDelete: ChatSession?
    @State private var showDeleteAlert = false

    var filteredSessions: [ChatSession] {
        guard !searchText.isEmpty else { return sessions }
        return sessions.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.participantNames.contains { $0.localizedCaseInsensitiveContains(searchText) }
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                if sessions.isEmpty {
                    emptyState
                } else {
                    sessionList
                }
            }
            .navigationTitle("LINE アナライザー")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { showImport = true }) {
                        Image(systemName: "plus.circle.fill")
                            .font(.title3)
                            .foregroundStyle(Theme.accent)
                    }
                }
            }
            .searchable(text: $searchText, prompt: "トーク名・メンバーで検索")
            .sheet(isPresented: $showImport) {
                ImportView()
            }
            .alert("削除の確認", isPresented: $showDeleteAlert, presenting: sessionToDelete) { session in
                Button("削除", role: .destructive) { deleteSession(session) }
                Button("キャンセル", role: .cancel) {}
            } message: { session in
                Text("「\(session.name)」を削除しますか？\nAI質問履歴も含めて削除されます。")
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 24) {
            ZStack {
                Circle()
                    .fill(Theme.accentMuted)
                    .frame(width: 100, height: 100)
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(Theme.accent)
            }

            VStack(spacing: 8) {
                Text("トーク履歴がありません")
                    .font(Theme.fontTitle)
                    .foregroundStyle(Theme.textPrimary)

                Text("LINEからエクスポートした\nトーク履歴（.txt）を読み込んでください")
                    .font(Theme.fontBody)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }

            Button(action: { showImport = true }) {
                Label("トークを読み込む", systemImage: "square.and.arrow.down")
                    .font(Theme.fontHeadline)
                    .foregroundStyle(.black)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 14)
                    .background(Theme.accent)
                    .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 40)
    }

    // MARK: - Session List

    private var sessionList: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(filteredSessions) { session in
                    NavigationLink(destination: SessionDetailView(session: session)) {
                        SessionRow(session: session)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button(role: .destructive) {
                            sessionToDelete = session
                            showDeleteAlert = true
                        } label: {
                            Label("削除", systemImage: "trash")
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .background(Theme.background)
    }

    private func deleteSession(_ session: ChatSession) {
        modelContext.delete(session)
        try? modelContext.save()
    }
}

// MARK: - Session Row

struct SessionRow: View {
    let session: ChatSession

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Theme.accentMuted)
                    .frame(width: 50, height: 50)
                Image(systemName: "message.fill")
                    .font(.title3)
                    .foregroundStyle(Theme.accent)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(session.name)
                    .font(Theme.fontHeadline)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)

                if !session.participantNames.isEmpty {
                    Text(session.participantNames.joined(separator: "、"))
                        .font(Theme.fontCaption)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }

                if !session.dateRangeText.isEmpty {
                    Text(session.dateRangeText)
                        .font(Theme.fontCaption)
                        .foregroundStyle(Theme.textTertiary)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text("\(session.messageCount)件")
                    .font(Theme.fontCaption)
                    .foregroundStyle(Theme.textTertiary)
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .cardStyle()
    }
}
