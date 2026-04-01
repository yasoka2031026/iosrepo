import Foundation

struct ParsedMessage {
    let timestamp: Date?
    let senderName: String
    let content: String
    let isSystem: Bool
}

struct ParseResult {
    let sessionName: String
    let messages: [ParsedMessage]
    let participants: Set<String>
    let startDate: Date?
    let endDate: Date?
}

enum LINEParser {

    // LINE エクスポート形式を解析する
    // 例:
    //   [LINE] トーク履歴
    //   保存日時：2024/01/01 00:00
    //
    //   2024/01/01(月)
    //   12:00	田中太郎	こんにちは！
    //   12:01	山田花子	こんにちは！
    static func parse(text: String, sessionName: String) -> ParseResult {
        let lines = text.components(separatedBy: "\n")

        var messages: [ParsedMessage] = []
        var participants: Set<String> = []
        var currentDate: Date?
        var firstDate: Date?
        var lastDate: Date?

        let calendar = Calendar(identifier: .gregorian)

        // 日付ヘッダー: "2024/01/01(月)" or "2024年1月1日(月)"
        let datePattern1 = /^(\d{4})\/(\d{2})\/(\d{2})\(.+\)$/
        let datePattern2 = /^(\d{4})年(\d{1,2})月(\d{1,2})日\(.+\)$/
        // メッセージ行: "12:00\t名前\t内容"
        let messagePattern = /^(\d{1,2}):(\d{2})\t(.+?)\t([\s\S]+)$/

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }

            // ヘッダー行をスキップ
            if trimmed.hasPrefix("[LINE]") || trimmed.hasPrefix("保存日時") { continue }

            // 日付ヘッダー1: YYYY/MM/DD(曜日)
            if let match = try? datePattern1.wholeMatch(in: trimmed) {
                currentDate = makeDate(
                    calendar: calendar,
                    year: Int(match.1)!,
                    month: Int(match.2)!,
                    day: Int(match.3)!
                )
                if firstDate == nil { firstDate = currentDate }
                lastDate = currentDate
                continue
            }

            // 日付ヘッダー2: YYYY年M月D日(曜日)
            if let match = try? datePattern2.wholeMatch(in: trimmed) {
                currentDate = makeDate(
                    calendar: calendar,
                    year: Int(match.1)!,
                    month: Int(match.2)!,
                    day: Int(match.3)!
                )
                if firstDate == nil { firstDate = currentDate }
                lastDate = currentDate
                continue
            }

            // メッセージ行
            if let match = try? messagePattern.wholeMatch(in: trimmed) {
                let hour = Int(match.1)!
                let minute = Int(match.2)!
                let sender = String(match.3)
                let content = String(match.4).trimmingCharacters(in: .whitespaces)

                var timestamp: Date?
                if let base = currentDate {
                    var comps = calendar.dateComponents([.year, .month, .day], from: base)
                    comps.hour = hour
                    comps.minute = minute
                    timestamp = calendar.date(from: comps)
                }

                participants.insert(sender)
                messages.append(ParsedMessage(
                    timestamp: timestamp,
                    senderName: sender,
                    content: content,
                    isSystem: false
                ))
            }
            // その他の行（システムメッセージ等）は無視
        }

        return ParseResult(
            sessionName: sessionName,
            messages: messages,
            participants: participants,
            startDate: firstDate,
            endDate: lastDate
        )
    }

    private static func makeDate(calendar: Calendar, year: Int, month: Int, day: Int) -> Date? {
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = day
        comps.hour = 0
        comps.minute = 0
        comps.second = 0
        return calendar.date(from: comps)
    }
}
