// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "AnonymizerKit",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "AnonymizerKit", targets: ["AnonymizerKit"]),
        .executable(name: "anonimizza", targets: ["anonimizza"]),
        .executable(name: "firma-rilascio", targets: ["firma-rilascio"]),
    ],
    targets: [
        // Motore di anonimizzazione, dizionario cifrato e documenti: tutto sul Mac.
        .target(name: "AnonymizerKit"),
        // Prove dal Terminale: `swift run anonimizza "Mario Rossi, CF RSSMRA85H12F205Y"`.
        .executableTarget(name: "anonimizza", dependencies: ["AnonymizerKit"]),
        // Firma dei DMG per gli aggiornamenti: `swift run firma-rilascio genera`.
        .executableTarget(name: "firma-rilascio", dependencies: ["AnonymizerKit"]),
        .testTarget(name: "AnonymizerKitTests", dependencies: ["AnonymizerKit"]),
    ]
)
