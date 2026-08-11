import SwiftUI
import SwiftData

struct SettingsView: View {
    @AppStorage("claude_api_key") private var apiKey = ""
    @State private var inputKey = ""
    @State private var showKey = false
    @State private var savedFeedback = false

    @Query private var sessions: [ChatSession]
    @Query private var queryResults: [AIQueryResult]
    @Environment(\.modelContext) private var modelContext

    @State private var showClearHistoryAlert = false
    @State private var showClearAllAlert = false

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                List {
                    apiKeySection
                    usageSection
                    dataSection
                    aboutSection
                }
                .scrollContentBackground(.hidden)
                .listStyle(.insetGrouped)
            }
            .navigationTitle("設定")
            .navigationBarTitleDisplayMode(.large)
            .onAppear { inputKey = apiKey }
            .alert("AI質問履歴を削除", isPresented: $showClearHistoryAlert) {
                Button("削除", role: .destructive) { clearQueryHistory() }
                Button("キャンセル", role: .cancel) {}
            } message: {
                Text("すべてのAI質問履歴を削除しますか？\nトーク履歴は削除されません。")
            }
            .alert("全データを削除", isPresented: $showClearAllAlert) {
                Button("削除", role: .destructive) { clearAllData() }
                Button("キャンセル", role: .cancel) {}
            } message: {
                Text("インポート済みのトーク履歴とAI質問履歴をすべて削除しますか？この操作は取り消せません。")
            }
        }
    }

    // MARK: - API Key Section

    private var apiKeySection: some View {
        Section {
            // ステータス
            HStack(spacing: 8) {
                Image(systemName: apiKey.isEmpty ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                    .foregroundStyle(apiKey.isEmpty ? Theme.warning : Theme.accent)
                Text(apiKey.isEmpty ? "APIキー未設定" : "APIキー設定済み")
                    .foregroundStyle(apiKey.isEmpty ? Theme.warning : Theme.accent)
                    .font(Theme.fontBody)
            }
            .listRowBackground(Theme.surface)

            // 入力フィールド
            HStack {
                Group {
                    if showKey {
                        TextField("sk-ant-api03-...", text: $inputKey)
                    } else {
                        SecureField("sk-ant-api03-...", text: $inputKey)
                    }
                }
                .font(Theme.fontMono)
                .foregroundStyle(Theme.textPrimary)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

                Button(action: { showKey.toggle() }) {
                    Image(systemName: showKey ? "eye.slash" : "eye")
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .listRowBackground(Theme.surfaceElevated)

            // 保存ボタン
            Button(action: saveKey) {
                HStack {
                    Spacer()
                    if savedFeedback {
                        Label("保存しました", systemImage: "checkmark")
                            .foregroundStyle(.black)
                    } else {
                        Text("保存する")
                            .foregroundStyle(.black)
                    }
                    Spacer()
                }
                .font(Theme.fontHeadline)
                .padding(.vertical, 6)
                .background(Theme.accent)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .listRowBackground(Theme.surface)
            .listRowInsets(.init(top: 8, leading: 16, bottom: 8, trailing: 16))

        } header: {
            sectionHeader("Claude API キー")
        } footer: {
            Text("APIキーは Anthropic Console (console.anthropic.com) で取得できます。キーはこのデバイスにのみ保存されます。")
                .foregroundStyle(Theme.textTertiary)
        }
    }

    // MARK: - Usage Section

    private var usageSection: some View {
        Section {
            settingRow(icon: "cpu", label: "使用モデル", value: "Claude Haiku（低コスト）")
            settingRow(icon: "dollarsign.circle", label: "コスト最適化", value: "有効")
            settingRow(icon: "bubble.left.and.text.bubble.right", label: "AI質問履歴", value: "\(queryResults.count)件")
        } header: {
            sectionHeader("使用状況")
        } footer: {
            Text("Claude Haiku はAnthropic最安モデルです。コンテキストは関連メッセージのみ送信することでコストを抑えています。")
                .foregroundStyle(Theme.textTertiary)
        }
    }

    // MARK: - Data Section

    private var dataSection: some View {
        Section {
            settingRow(icon: "tray.2.fill", label: "インポート済みトーク", value: "\(sessions.count)件")

            Button(action: { showClearHistoryAlert = true }) {
                Label("AI質問履歴を削除", systemImage: "clock.arrow.circlepath")
                    .foregroundStyle(Theme.destructive)
            }
            .listRowBackground(Theme.surface)

            Button(action: { showClearAllAlert = true }) {
                Label("全データを削除", systemImage: "trash.fill")
                    .foregroundStyle(Theme.destructive)
            }
            .listRowBackground(Theme.surface)
        } header: {
            sectionHeader("データ管理")
        }
    }

    // MARK: - About Section

    private var aboutSection: some View {
        Section {
            settingRow(icon: "iphone", label: "バージョン", value: "1.0.0")
            settingRow(icon: "swift", label: "最小 iOS", value: "17.0")
            settingRow(icon: "lock.shield", label: "データ保存", value: "端末内のみ")
        } header: {
            sectionHeader("アプリ情報")
        }
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(Theme.fontCaption)
            .foregroundStyle(Theme.textSecondary)
            .textCase(nil)
    }

    private func settingRow(icon: String, label: String, value: String) -> some View {
        HStack {
            Label(label, systemImage: icon)
                .foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value)
                .font(Theme.fontBody)
                .foregroundStyle(Theme.textTertiary)
        }
        .listRowBackground(Theme.surface)
    }

    private func saveKey() {
        apiKey = inputKey.trimmingCharacters(in: .whitespaces)
        ClaudeAPIService.shared.apiKey = apiKey
        savedFeedback = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            savedFeedback = false
        }
    }

    private func clearQueryHistory() {
        queryResults.forEach { modelContext.delete($0) }
        try? modelContext.save()
    }

    private func clearAllData() {
        sessions.forEach { modelContext.delete($0) }
        queryResults.forEach { modelContext.delete($0) }
        try? modelContext.save()
    }
}
