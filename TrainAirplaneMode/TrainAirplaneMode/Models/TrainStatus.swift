import Foundation
import CoreLocation

enum MonitoringState {
    case idle
    case monitoring
    case onTrain
    case departed

    var displayText: String {
        switch self {
        case .idle:       return "停止中"
        case .monitoring: return "監視中"
        case .onTrain:    return "電車検知"
        case .departed:   return "下車検知"
        }
    }
}

struct TrainStatus {
    var state: MonitoringState = .idle
    var speedMs: Double = 0          // m/s (CLLocation.speed)
    var confidence: Double = 0       // 0.0 – 1.0
    var lastUpdated: Date = .distantPast
    var consecutiveHits: Int = 0

    var speedKmh: Double { speedMs * 3.6 }
    var isOnTrain: Bool  { state == .onTrain }
}
