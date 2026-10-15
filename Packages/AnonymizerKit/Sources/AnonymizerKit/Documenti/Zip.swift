import Compression
import Foundation

// MARK: - Archivi ZIP (i file .xlsx e .docx)
//
// Excel e Word salvano i documenti come archivi ZIP di file XML. Qui si leggono e si riscrivono senza librerie esterne:
// DEFLATE «grezzo» con il framework Compression di Apple, CRC-32 calcolato qui. Le voci che non cambiano si
// ricopiano byte per byte, compresse com'erano. Niente ZIP64 (servirebbe sopra i 4 GB) e niente archivi cifrati.

struct ZipEntry: Sendable {
    let name: String
    /// Contenuto in chiaro.
    private(set) var data: Data
    fileprivate(set) var method: UInt16
    fileprivate(set) var modificationTime: UInt16
    fileprivate(set) var modificationDate: UInt16
    fileprivate(set) var externalAttributes: UInt32
    /// I byte compressi originali, finché il contenuto non cambia.
    fileprivate var original: (compressed: Data, crc: UInt32)?

    init(name: String, data: Data, method: UInt16 = 8) {
        self.name = name
        self.data = data
        self.method = method
        (modificationTime, modificationDate) = Self.dosDateTime(.now)
        externalAttributes = 0
    }

    /// Nuovo contenuto: al salvataggio si ricomprime.
    mutating func replace(_ data: Data) {
        self.data = data
        original = nil
        if method == 0 { method = 8 }
    }

    static func dosDateTime(_ date: Date) -> (time: UInt16, date: UInt16) {
        let parts = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let time = UInt16((parts.hour ?? 0) << 11 | (parts.minute ?? 0) << 5 | (parts.second ?? 0) / 2)
        let day = UInt16(max(0, (parts.year ?? 1980) - 1980) << 9 | (parts.month ?? 1) << 5 | (parts.day ?? 1))
        return (time, day)
    }
}

enum ZipArchive {
    enum ZipError: LocalizedError, Equatable {
        case notAnArchive
        case unsupported(String)
        case corrupted(String)

        var errorDescription: String? {
            switch self {
            case .notAnArchive: "Il file non è un documento Office valido (archivio ZIP non leggibile)."
            case .unsupported(let reason): "Documento non gestito: \(reason)."
            case .corrupted(let name): "Il documento è danneggiato (\(name))."
            }
        }
    }

    // MARK: Lettura

    static func read(_ data: Data) throws -> [ZipEntry] {
        let bytes = [UInt8](data)
        guard let end = endOfCentralDirectory(bytes) else { throw ZipError.notAnArchive }
        let count = Int(u16(bytes, end + 10))
        var offset = Int(u32(bytes, end + 16))
        guard count != 0xFFFF, offset != 0xFFFF_FFFF else { throw ZipError.unsupported("archivio ZIP64") }
        var entries: [ZipEntry] = []
        entries.reserveCapacity(count)
        for _ in 0..<count {
            guard offset + 46 <= bytes.count, u32(bytes, offset) == 0x0201_4b50 else { throw ZipError.corrupted("indice dell'archivio") }
            let flags = u16(bytes, offset + 8)
            let method = u16(bytes, offset + 10)
            let time = u16(bytes, offset + 12)
            let date = u16(bytes, offset + 14)
            let crc = u32(bytes, offset + 16)
            let compressedSize = Int(u32(bytes, offset + 20))
            let size = Int(u32(bytes, offset + 24))
            let nameLength = Int(u16(bytes, offset + 28))
            let extraLength = Int(u16(bytes, offset + 30))
            let commentLength = Int(u16(bytes, offset + 32))
            let attributes = u32(bytes, offset + 38)
            let localOffset = Int(u32(bytes, offset + 42))
            guard offset + 46 + nameLength <= bytes.count else { throw ZipError.corrupted("indice dell'archivio") }
            let name = String(decoding: bytes[(offset + 46)..<(offset + 46 + nameLength)], as: UTF8.self)
            offset += 46 + nameLength + extraLength + commentLength
            guard flags & 1 == 0 else { throw ZipError.unsupported("documento protetto da password") }
            guard compressedSize != 0xFFFF_FFFF, size != 0xFFFF_FFFF, localOffset != 0xFFFF_FFFF else {
                throw ZipError.unsupported("archivio ZIP64")
            }
            // L'intestazione locale può avere un campo extra diverso da quello dell'indice.
            guard localOffset + 30 <= bytes.count, u32(bytes, localOffset) == 0x0403_4b50 else { throw ZipError.corrupted(name) }
            let start = localOffset + 30 + Int(u16(bytes, localOffset + 26)) + Int(u16(bytes, localOffset + 28))
            guard start + compressedSize <= bytes.count else { throw ZipError.corrupted(name) }
            let compressed = Data(bytes[start..<(start + compressedSize)])
            let content: Data
            switch method {
            case 0: content = compressed
            case 8: content = try inflate(compressed, size: size, name: name)
            default: throw ZipError.unsupported("compressione \(method) in \(name)")
            }
            guard crc32(content) == crc else { throw ZipError.corrupted(name) }
            var entry = ZipEntry(name: name, data: content, method: method)
            entry.modificationTime = time
            entry.modificationDate = date
            entry.externalAttributes = attributes
            entry.original = (compressed, crc)
            entries.append(entry)
        }
        return entries
    }

    private static func endOfCentralDirectory(_ bytes: [UInt8]) -> Int? {
        guard bytes.count >= 22 else { return nil }
        let lowest = max(0, bytes.count - 22 - 65_535)
        var index = bytes.count - 22
        while index >= lowest {
            if u32(bytes, index) == 0x0605_4b50 { return index }
            index -= 1
        }
        return nil
    }

    private static func inflate(_ data: Data, size: Int, name: String) throws -> Data {
        guard size > 0 else { return Data() }
        var output = Data(count: size)
        let written = output.withUnsafeMutableBytes { destination in
            data.withUnsafeBytes { source in
                compression_decode_buffer(destination.bindMemory(to: UInt8.self).baseAddress!, size,
                                          source.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written == size else { throw ZipError.corrupted(name) }
        return output
    }

    // MARK: Scrittura

    static func write(_ entries: [ZipEntry]) throws -> Data {
        var output = Data()
        var central = Data()
        for entry in entries {
            let offset = output.count
            let crc: UInt32
            let compressed: Data
            var method = entry.method
            if let original = entry.original {
                (compressed, crc) = original
            } else {
                crc = crc32(entry.data)
                if method == 8, let deflated = deflate(entry.data) {
                    compressed = deflated
                } else {
                    method = 0
                    compressed = entry.data
                }
            }
            guard output.count < 0xFFFF_FFFF, compressed.count < 0xFFFF_FFFF else { throw ZipError.unsupported("archivio oltre i 4 GB") }
            let name = Data(entry.name.utf8)
            let utf8Flag: UInt16 = entry.name.allSatisfy(\.isASCII) ? 0 : 0x0800
            var local = Data()
            append32(&local, 0x0403_4b50)
            append16(&local, 20)
            append16(&local, utf8Flag)
            append16(&local, method)
            append16(&local, entry.modificationTime)
            append16(&local, entry.modificationDate)
            append32(&local, crc)
            append32(&local, UInt32(compressed.count))
            append32(&local, UInt32(entry.data.count))
            append16(&local, UInt16(name.count))
            append16(&local, 0)
            output.append(local)
            output.append(name)
            output.append(compressed)

            append32(&central, 0x0201_4b50)
            append16(&central, 20)
            append16(&central, 20)
            append16(&central, utf8Flag)
            append16(&central, method)
            append16(&central, entry.modificationTime)
            append16(&central, entry.modificationDate)
            append32(&central, crc)
            append32(&central, UInt32(compressed.count))
            append32(&central, UInt32(entry.data.count))
            append16(&central, UInt16(name.count))
            append16(&central, 0)
            append16(&central, 0)
            append16(&central, 0)
            append16(&central, 0)
            append32(&central, entry.externalAttributes)
            append32(&central, UInt32(offset))
            central.append(name)
        }
        let centralOffset = output.count
        output.append(central)
        var end = Data()
        append32(&end, 0x0605_4b50)
        append16(&end, 0)
        append16(&end, 0)
        append16(&end, UInt16(entries.count))
        append16(&end, UInt16(entries.count))
        append32(&end, UInt32(central.count))
        append32(&end, UInt32(centralOffset))
        append16(&end, 0)
        output.append(end)
        return output
    }

    private static func deflate(_ data: Data) -> Data? {
        guard !data.isEmpty else { return nil }
        let capacity = data.count + data.count / 10 + 1024
        var output = Data(count: capacity)
        let written = output.withUnsafeMutableBytes { destination in
            data.withUnsafeBytes { source in
                compression_encode_buffer(destination.bindMemory(to: UInt8.self).baseAddress!, capacity,
                                          source.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written > 0, written < data.count else { return nil }
        output.count = written
        return output
    }

    // MARK: Supporto

    private static func u16(_ bytes: [UInt8], _ offset: Int) -> UInt16 {
        UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8
    }

    private static func u32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
        UInt32(bytes[offset]) | UInt32(bytes[offset + 1]) << 8 | UInt32(bytes[offset + 2]) << 16 | UInt32(bytes[offset + 3]) << 24
    }

    private static func append16(_ data: inout Data, _ value: UInt16) {
        withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
    }

    private static func append32(_ data: inout Data, _ value: UInt32) {
        withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
    }

    private static let crcTable: [UInt32] = (0..<256).map { index in
        var value = UInt32(index)
        for _ in 0..<8 { value = value & 1 == 1 ? 0xEDB8_8320 ^ (value >> 1) : value >> 1 }
        return value
    }

    static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        data.withUnsafeBytes { buffer in
            for byte in buffer { crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8) }
        }
        return crc ^ 0xFFFF_FFFF
    }
}

extension Array where Element == ZipEntry {
    subscript(entry name: String) -> ZipEntry? {
        first { $0.name == name }
    }

    mutating func replace(_ name: String, with data: Data) {
        if let index = firstIndex(where: { $0.name == name }) { self[index].replace(data) }
    }
}
