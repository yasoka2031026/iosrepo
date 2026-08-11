import SwiftUI

struct MessageRow: View {
    let message: ChatMessage
    var searchText: String = ""

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // 時刻
            Text(message.timeText)
                .font(Theme.fontMono)
                .foregroundStyle(Theme.textTertiary)
                .frame(width: 44, alignment: .leading)
                .padding(.top, 1)

            // 送信者 + 本文
            VStack(alignment: .leading, spacing: 3) {
                Text(message.senderName)
                    .font(Theme.fontCaption)
                    .foregroundStyle(Theme.accent)

                if message.isSpecialContent {
                    Text(message.content)
                        .font(Theme.fontBody)
                        .foregroundStyle(Theme.textTertiary)
                        .italic()
                } else if searchText.isEmpty {
                    Text(message.content)
                        .font(Theme.fontBody)
                        .foregroundStyle(Theme.textPrimary)
                } else {
                    highlightedText(message.content, search: searchText)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private func highlightedText(_ text: String, search: String) -> Text {
        let lower = text.lowercased()
        let searchLower = search.lowercased()

        guard let range = lower.range(of: searchLower) else {
            return Text(text).font(Theme.fontBody).foregroundColor(Theme.textPrimary)
        }

        let before = String(text[text.startIndex..<range.lowerBound])
        let matched = String(text[range])
        let after = String(text[range.upperBound...])

        return Text(before).font(Theme.fontBody).foregroundColor(Theme.textPrimary)
            + Text(matched).font(Theme.fontBody).foregroundColor(.black).background(Theme.accent)
            + Text(after).font(Theme.fontBody).foregroundColor(Theme.textPrimary)
    }
}
