import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct ImportView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var isPickerPresented = false
    @State private var isProcessing = false
    @State private var progress: Double = 0
    @State private var statusText = ""
    @State private var errorMessage: String?
    @State private var importedCount = 0

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 28) {
                        // アイコン
                        ZStack {
                            RoundedRectangle(cornerRadius: 24)
                                .fill(Theme.accentMuted)
                                .frame(width: 90, height: 90)
                            Image(systemName: "square.and.arrow.down.fill")
                                .font(.system(size: 40))
                                .foregroundStyle(Theme.accent)
                        }
                        .padding(.top, 16)

                        VStack(spacing: 10) {
                            Text("トーク履歴を読み込む")
                                .font(Theme.fontTitle)
                                .foregroundStyle(Theme.textPrimary)

                            Text("LINEでエクスポートした\nテキスト形式（.txt）のファイルを選択してください")
                                .font(Theme.fontBody)
                                .foregroundStyle(Theme.textSecondary)
                                .multilineTextAlignment(.center)
                        }

                        // 進捗表示
                        if isProcessing {
                            VStack(spacing: 12) {
                                ProgressView(value: progress)
                                    .progressViewStyle(.linear)
                                    .tint(Theme.accent)
                                    .padding(.horizontal)

                                Text(statusText)
                                    .font(Theme.fontCaption)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            .padding()
                            .cardStyle()
                            .padding(.horizontal)
                        }

                        // エラー表示
                        if let error = errorMessage {
                            HStack(spacing: 10) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(Theme.destructive)
                                Text(error)
                                    .font(Theme.fontBody)
                                    .foregroundStyle(Theme.destructive)
                            }
                            .padding()
                            .background(Theme.destructive.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .padding(.horizontal)
                        }

                        // エクスポート手順
                        exportInstructions

                        Spacer(minLength: 20)

                        // ファイル選択ボタン
                        Button(action: { isPickerPresented = true }) {
                            HStack {
                                if isProcessing {
                                    ProgressView()
                                        .progressViewStyle(.circular)
                                        .scaleEffect(0.8)
                                        .tint(.black)
                                } else {
                                    Image(systemName: "doc.badge.plus")
                                }
                                Text(isProcessing ? "読み込み中..." : "ファイルを選択")
                            }
                            .font(Theme.fontHeadline)
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(isProcessing ? Theme.accent.opacity(0.6) : Theme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .disabled(isProcessing)
                        .padding(.horizontal)
                        .padding(.bottom, 16)
                    }
                }
            }
            .navigationTitle("読み込み")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("閉じる") { dismiss() }
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .fileImporter(
                isPresented: $isPickerPresented,
                allowedContentTypes: [.plainText],
                allowsMultipleSelection: true
            ) { result in
                handlePickerResult(result)
            }
        }
    }

    // MARK: - エクスポート手順

    private var exportInstructions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("LINEからのエクスポート手順", systemImage: "info.circle")
                .font(Theme.fontHeadline)
                .foregroundStyle(Theme.textSecondary)

            VStack(alignment: .leading, spacing: 8) {
                instructionStep(number: "1", text: "LINEのトーク画面を開く")
                instructionStep(number: "2", text: "右上の「≡」→「その他」→「トーク履歴を送信」")
                instructionStep(number: "3", text: "「テキスト形式」を選択し、ファイルアプリなどに保存")
                instructionStep(number: "4", text: "上のボタンで保存した .txt ファイルを選択")
            }
        }
        .padding()
        .cardStyle()
        .padding(.horizontal)
    }

    private func instructionStep(number: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            ZStack {
                Circle()
                    .fill(Theme.accentMuted)
                    .frame(width: 22, height: 22)
                Text(number)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.accent)
            }
            Text(text)
                .font(Theme.fontBody)
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Import Logic

    private func handlePickerResult(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard !urls.isEmpty else { return }
            isProcessing = true
            progress = 0
            errorMessage = nil
            importedCount = 0

            Task {
                for (i, url) in urls.enumerated() {
                    await importFile(url: url, index: i, total: urls.count)
                }
                await MainActor.run {
                    isProcessing = false
                    if importedCount > 0 { dismiss() }
                }
            }

        case .failure(let error):
            errorMessage = "ファイル選択エラー: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func importFile(url: URL, index: Int, total: Int) async {
        let name = url.deletingPathExtension().lastPathComponent
        statusText = "解析中: \(name)"

        guard url.startAccessingSecurityScopedResource() else {
            errorMessage = "ファイルへのアクセスが拒否されました"
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }

        do {
            let raw = try String(contentsOf: url, encoding: .utf8)

            statusText = "メッセージを処理中..."
            let result = await Task.detached(priority: .userInitiated) {
                LINEParser.parse(text: raw, sessionName: name)
            }.value

            let session = ChatSession(
                name: result.sessionName,
                rawContent: raw,
                participantNames: Array(result.participants).sorted(),
                messageCount: result.messages.count,
                startDate: result.startDate,
                endDate: result.endDate
            )
            modelContext.insert(session)

            for msg in result.messages {
                let chatMsg = ChatMessage(
                    timestamp: msg.timestamp,
                    senderName: msg.senderName,
                    content: msg.content,
                    isSystem: msg.isSystem
                )
                chatMsg.session = session
                modelContext.insert(chatMsg)
            }
            try modelContext.save()

            importedCount += 1
            progress = Double(index + 1) / Double(total)
            statusText = "\(result.messages.count)件のメッセージを読み込みました"

        } catch {
            errorMessage = "読み込みエラー: \(error.localizedDescription)"
        }
    }
}
