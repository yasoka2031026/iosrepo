import SwiftUI
import SwiftData

@main
struct LineChatAnalyzerApp: App {
    let container: ModelContainer

    init() {
        do {
            container = try ModelContainer(
                for: ChatSession.self, ChatMessage.self, AIQueryResult.self
            )
        } catch {
            fatalError("ModelContainer の作成に失敗しました: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .modelContainer(container)
                .preferredColorScheme(.dark)
        }
    }
}
