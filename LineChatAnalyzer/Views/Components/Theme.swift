import SwiftUI

enum Theme {
    // MARK: - 背景色
    static let background      = Color(hex: "0D0D0D")
    static let surface         = Color(hex: "1A1A1A")
    static let surfaceElevated = Color(hex: "252525")

    // MARK: - テキスト色
    static let textPrimary   = Color(hex: "F0F0F0")
    static let textSecondary = Color(hex: "8A8A8A")
    static let textTertiary  = Color(hex: "4A4A4A")

    // MARK: - アクセント (LINE グリーン)
    static let accent      = Color(hex: "06C755")
    static let accentMuted = Color(hex: "0A2E18")

    // MARK: - セマンティック
    static let divider     = Color(hex: "2A2A2A")
    static let destructive = Color(hex: "FF453A")
    static let warning     = Color(hex: "FF9F0A")

    // MARK: - フォント
    static let fontTitle    = Font.system(size: 20, weight: .semibold)
    static let fontHeadline = Font.system(size: 16, weight: .semibold)
    static let fontBody     = Font.system(size: 15, weight: .regular)
    static let fontCaption  = Font.system(size: 12, weight: .regular)
    static let fontMono     = Font.system(size: 13, weight: .regular, design: .monospaced)
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:  (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:  (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:  (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - カスタム ViewModifier

struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardStyle())
    }
}

// MARK: - FlowLayout (タグ表示用)

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var height: CGFloat = 0
        var rowX: CGFloat = 0
        var rowH: CGFloat = 0

        for sub in subviews {
            let s = sub.sizeThatFits(.unspecified)
            if rowX + s.width > maxWidth, rowX > 0 {
                height += rowH + spacing
                rowX = 0; rowH = 0
            }
            rowX += s.width + spacing
            rowH = max(rowH, s.height)
        }
        return CGSize(width: maxWidth, height: height + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowH: CGFloat = 0

        for sub in subviews {
            let s = sub.sizeThatFits(.unspecified)
            if x + s.width > bounds.maxX, x > bounds.minX {
                y += rowH + spacing; x = bounds.minX; rowH = 0
            }
            sub.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            rowH = max(rowH, s.height)
        }
    }
}
