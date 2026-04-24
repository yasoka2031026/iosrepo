import SwiftUI
import CoreLocation

struct ContentView: View {
    @StateObject private var detection  = TrainDetectionService.shared
    @StateObject private var location   = LocationService.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    StatusCard(status: detection.status)
                    SpeedCard(speedKmh: detection.status.speedKmh)
                    ConfidenceCard(confidence: detection.status.confidence)
                    AirplaneModeCard()
                    ControlButton(
                        isMonitoring: detection.status.state != .idle,
                        onStart: startMonitoring,
                        onStop: detection.stopDetection
                    )
                }
                .padding()
            }
            .navigationTitle("電車機内モード")
            .onAppear(perform: requestPermissions)
        }
    }

    private func requestPermissions() {
        location.requestAlwaysAuthorization()
        NotificationService.shared.requestAuthorization()
    }

    private func startMonitoring() {
        guard location.authorizationStatus == .authorizedAlways ||
              location.authorizationStatus == .authorizedWhenInUse else {
            location.requestAlwaysAuthorization()
            return
        }
        detection.startDetection()
    }
}

// MARK: – Sub-views

private struct StatusCard: View {
    let status: TrainStatus

    private var color: Color {
        switch status.state {
        case .idle:       return .gray
        case .monitoring: return .blue
        case .onTrain:    return .green
        case .departed:   return .orange
        }
    }

    private var icon: String {
        switch status.state {
        case .idle:       return "pause.circle"
        case .monitoring: return "antenna.radiowaves.left.and.right"
        case .onTrain:    return "tram.fill"
        case .departed:   return "figure.walk"
        }
    }

    var body: some View {
        CardContainer {
            HStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.system(size: 44))
                    .foregroundStyle(color)
                VStack(alignment: .leading, spacing: 4) {
                    Text("状態")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(status.state.displayText)
                        .font(.title2.bold())
                        .foregroundStyle(color)
                    if status.state != .idle {
                        Text("最終更新: \(status.lastUpdated.formatted(date: .omitted, time: .standard))")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                Spacer()
            }
        }
    }
}

private struct SpeedCard: View {
    let speedKmh: Double

    var body: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 8) {
                Label("現在速度", systemImage: "speedometer")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(speedKmh > 0 ? String(format: "%.0f", speedKmh) : "—")
                        .font(.system(size: 52, weight: .semibold, design: .rounded))
                    Text("km/h")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }

                // Indicator bar: 0 – 320 km/h
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color(.systemFill))
                            .frame(height: 8)
                        RoundedRectangle(cornerRadius: 4)
                            .fill(speedColor)
                            .frame(width: geo.size.width * min(speedKmh / 320, 1), height: 8)
                    }
                }
                .frame(height: 8)

                HStack {
                    Text("0")
                    Spacer()
                    Text("検知範囲: 20 – 320 km/h")
                    Spacer()
                    Text("320")
                }
                .font(.caption2)
                .foregroundStyle(.tertiary)
            }
        }
    }

    private var speedColor: Color {
        switch speedKmh {
        case ..<20:   return .gray
        case 20..<80: return .green
        case 80..<160: return .blue
        default:      return .purple
        }
    }
}

private struct ConfidenceCard: View {
    let confidence: Double

    var body: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 8) {
                Label("電車確信度", systemImage: "chart.bar.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack {
                    Text(String(format: "%.0f%%", confidence * 100))
                        .font(.title.bold())
                    Spacer()
                    ProgressView(value: confidence)
                        .tint(confidence >= 0.65 ? .green : .orange)
                        .frame(width: 120)
                }
                Text("65% 以上で電車乗車と判定")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

private struct AirplaneModeCard: View {
    var body: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 10) {
                Label("機内モードについて", systemImage: "airplane")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("iOS の制限により、アプリが機内モードを自動でオンにすることはできません。電車検知時に通知が届きますので、そこから設定を開いてください。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Label("設定を開く", systemImage: "gear")
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.blue)
            }
        }
    }
}

private struct ControlButton: View {
    let isMonitoring: Bool
    let onStart: () -> Void
    let onStop: () -> Void

    var body: some View {
        Button(action: isMonitoring ? onStop : onStart) {
            Label(
                isMonitoring ? "監視を停止" : "監視を開始",
                systemImage: isMonitoring ? "stop.circle.fill" : "play.circle.fill"
            )
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
        }
        .buttonStyle(.borderedProminent)
        .tint(isMonitoring ? .red : .green)
        .controlSize(.large)
    }
}

// MARK: – Helper

private struct CardContainer<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
    }
}
