import Foundation
import CoreLocation
import Combine

/// Detects whether the user is on a train using GPS speed and movement consistency.
///
/// iOS has no public API to toggle Airplane Mode, so this service detects train travel
/// and fires local notifications prompting the user to enable it manually.
final class TrainDetectionService: ObservableObject {
    static let shared = TrainDetectionService()

    @Published private(set) var status = TrainStatus()

    // MARK: – Thresholds

    /// Japanese trains: local ~20 km/h minimum, Shinkansen ~320 km/h maximum
    private let minSpeedMs: Double = 5.6    // 20 km/h
    private let maxSpeedMs: Double = 88.9   // 320 km/h

    /// How many consecutive qualifying readings to declare "on train"
    private let hitsRequired = 4

    /// How many consecutive non-qualifying readings to declare "departed"
    private let missesRequired = 6

    // MARK: – State

    private var missCount = 0
    private var locationHistory: [CLLocation] = []
    private let historyMax = 8

    private var cancellables = Set<AnyCancellable>()
    private let locationService = LocationService.shared

    private init() {}

    // MARK: – Public control

    func startDetection() {
        guard status.state == .idle else { return }
        locationService.startUpdating()
        status.state = .monitoring
        missCount = 0

        locationService.$currentLocation
            .compactMap { $0 }
            .sink { [weak self] location in
                self?.process(location)
            }
            .store(in: &cancellables)
    }

    func stopDetection() {
        cancellables.removeAll()
        locationService.stopUpdating()
        locationHistory.removeAll()
        status = TrainStatus()   // reset to idle
    }

    // MARK: – Core detection logic

    private func process(_ location: CLLocation) {
        let speed = max(0, location.speed)   // CLLocation returns -1 when invalid
        status.speedMs    = speed
        status.lastUpdated = location.timestamp

        updateHistory(location)

        let speedOK   = speed >= minSpeedMs && speed <= maxSpeedMs
        let courseOK  = isCourseConsistent()
        let confidence = computeConfidence(speedOK: speedOK, courseOK: courseOK)

        status.confidence = confidence

        let qualifying = confidence >= 0.65

        if qualifying {
            missCount = 0
            let hits = status.consecutiveHits + 1
            status.consecutiveHits = hits

            if hits >= hitsRequired, status.state != .onTrain {
                status.state = .onTrain
                NotificationService.shared.sendTrainDetectedNotification()
            }
        } else {
            missCount += 1
            status.consecutiveHits = max(0, status.consecutiveHits - 1)

            if missCount >= missesRequired, status.state == .onTrain {
                status.state = .departed
                NotificationService.shared.sendDepartedNotification()
                // Return to monitoring after a short delay
                DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                    if self?.status.state == .departed {
                        self?.status.state = .monitoring
                        self?.missCount = 0
                    }
                }
            }
        }
    }

    private func updateHistory(_ location: CLLocation) {
        locationHistory.append(location)
        if locationHistory.count > historyMax {
            locationHistory.removeFirst()
        }
    }

    /// Returns true when the bearing changes smoothly (trains follow fixed tracks).
    private func isCourseConsistent() -> Bool {
        let validCourses = locationHistory
            .map(\.course)
            .filter { $0 >= 0 }     // negative = invalid

        guard validCourses.count >= 3 else { return true }

        var totalChange = 0.0
        for i in 1..<validCourses.count {
            var diff = abs(validCourses[i] - validCourses[i - 1])
            if diff > 180 { diff = 360 - diff }
            totalChange += diff
        }
        let avgChange = totalChange / Double(validCourses.count - 1)

        // Trains rarely deviate more than ~25° between consecutive GPS readings
        return avgChange < 25
    }

    /// Weighted confidence score from 0 to 1.
    private func computeConfidence(speedOK: Bool, courseOK: Bool) -> Double {
        var score = 0.0
        if speedOK   { score += 0.70 }
        if courseOK  { score += 0.30 }
        return score
    }
}
