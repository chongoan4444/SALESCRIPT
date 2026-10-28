#!/usr/bin/env python3
"""
Dong goi extension/ thanh file .crx (CRX3, co chu ky RSA) + update.xml
de phat hanh qua GitHub Pages (Chrome tu cai + tu cap nhat qua policy).

Cach dung:
    pip install cryptography        # chi can 1 lan
    python installer/build-crx.py

Ket qua:
    installer/extension-signing-key.pem  (khoa ky - TU DONG TAO LAN DAU, PHAI GIU KINH)
    docs/botfake.crx                     (file extension da ky)
    docs/update.xml                      (file Chrome doc de tu cap nhat)

Moi lan ra ban moi: chi can chay lai script nay roi commit docs/ len main.
Extension ID co dinh theo khoa ky -> may da cai se tu cap nhat, khong phai cai lai.
"""
import argparse
import hashlib
import io
import json
import struct
import sys
import zipfile
from pathlib import Path

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
except ImportError:
    sys.exit("Thieu thu vien 'cryptography'. Chay: pip install cryptography")

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_UPDATE_BASE = "https://chongoan4444.github.io/SALESCRIPT"


# ---------- protobuf toi gian (chi can varint + length-delimited) ----------
def varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def field_bytes(field_no: int, data: bytes) -> bytes:
    return varint((field_no << 3) | 2) + varint(len(data)) + data


# ---------- khoa ky ----------
def load_or_create_key(key_path: Path):
    if key_path.exists():
        return serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    print(f"[key] Da tao khoa ky moi: {key_path}")
    print("[key] *** PHAI GIU FILE NAY KIN THAN. Mat khoa = mat extension ID, moi may phai cai lai. ***")
    return key


def crx_id_from_spki(spki_der: bytes) -> bytes:
    return hashlib.sha256(spki_der).digest()[:16]


def crx_id_str(crx_id: bytes) -> str:
    # Chrome map moi nibble 0-15 sang chu a-p
    return "".join(chr(ord("a") + (b >> 4)) + chr(ord("a") + (b & 0x0F)) for b in crx_id)


# ---------- dong zip ----------
def build_zip(ext_dir: Path, update_url: str) -> bytes:
    manifest_path = ext_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    version = manifest["version"]
    manifest["update_url"] = update_url  # chi ban dong goi moi co update_url, ban unpacked giu nguyen

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(ext_dir.rglob("*")):
            if not p.is_file():
                continue
            arc = p.relative_to(ext_dir).as_posix()
            if arc.startswith(".") or "/." in arc or arc == "README.md":
                continue
            if arc == "manifest.json":
                z.writestr(arc, json.dumps(manifest, indent=2, ensure_ascii=False))
            else:
                z.write(p, arc)
    return buf.getvalue(), version


# ---------- ky CRX3 ----------
def pack_crx3(zip_bytes: bytes, key) -> tuple[bytes, str]:
    spki = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    crx_id = crx_id_from_spki(spki)
    signed_header_data = field_bytes(1, crx_id)  # SignedData { crx_id }
    to_sign = (
        b"CRX3 SignedData\x00"
        + struct.pack("<I", len(signed_header_data))
        + signed_header_data
        + zip_bytes
    )
    signature = key.sign(to_sign, padding.PKCS1v15(), hashes.SHA256())
    proof = field_bytes(1, spki) + field_bytes(2, signature)  # AsymmetricKeyProof
    header = field_bytes(2, proof) + field_bytes(10000, signed_header_data)  # CrxFileHeader
    crx = b"Cr24" + struct.pack("<I", 3) + struct.pack("<I", len(header)) + header + zip_bytes
    return crx, crx_id_str(crx_id)


def _pb_fields(buf: bytes):
    """Giai ma protobuf toi gian: tra ve list (field_no, bytes) cho field dang length-delimited."""
    out, i = [], 0
    while i < len(buf):
        tag, i = _pb_varint(buf, i)
        field_no, wire = tag >> 3, tag & 7
        if wire == 2:
            ln, i = _pb_varint(buf, i)
            out.append((field_no, buf[i:i + ln]))
            i += ln
        elif wire == 0:
            _, i = _pb_varint(buf, i)
        else:
            raise ValueError(f"wire type khong ho tro: {wire}")
    return out


def _pb_varint(buf: bytes, i: int):
    val = shift = 0
    while True:
        b = buf[i]
        i += 1
        val |= (b & 0x7F) << shift
        if not (b & 0x80):
            return val, i
        shift += 7


def verify_crx3(crx: bytes, expect_id: str) -> None:
    assert crx[:4] == b"Cr24", "sai magic"
    ver, hlen = struct.unpack("<II", crx[4:12])
    assert ver == 3, "khong phai CRX3"
    header, zip_bytes = crx[12:12 + hlen], crx[12 + hlen:]
    fields = dict(_pb_fields(header))
    proof = dict(_pb_fields(fields[2]))          # AsymmetricKeyProof dau tien
    spki, signature = proof[1], proof[2]
    signed_header_data = fields[10000]
    assert crx_id_str(crx_id_from_spki(spki)) == expect_id, "id trong file khong khop khoa ky"
    pub = serialization.load_der_public_key(spki)
    pub.verify(
        signature,
        b"CRX3 SignedData\x00" + struct.pack("<I", len(signed_header_data)) + signed_header_data + zip_bytes,
        padding.PKCS1v15(),
        hashes.SHA256(),
    )  # sai chu ky se nem InvalidSignature
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        names = z.namelist()
        assert "manifest.json" in names, "zip thieu manifest.json"
    print(f"[verify] CRX3 hop le + chu ky RSA dung: {len(names)} file trong zip, {len(crx)} byte, id={expect_id}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ext-dir", default=str(REPO_ROOT / "extension"))
    ap.add_argument("--key", default=str(REPO_ROOT / "installer" / "extension-signing-key.pem"))
    ap.add_argument("--out-dir", default=str(REPO_ROOT / "docs"))
    ap.add_argument("--update-base", default=DEFAULT_UPDATE_BASE,
                    help="URL goc noi host update.xml + botfake.crx")
    args = ap.parse_args()

    key = load_or_create_key(Path(args.key))
    update_url = args.update_base.rstrip("/") + "/update.xml"
    codebase = args.update_base.rstrip("/") + "/botfake.crx"

    zip_bytes, version = build_zip(Path(args.ext_dir), update_url)
    crx, ext_id = pack_crx3(zip_bytes, key)
    verify_crx3(crx, ext_id)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "botfake.crx").write_bytes(crx)
    update_xml = (
        "<?xml version='1.0' encoding='UTF-8'?>\n"
        "<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n"
        f"  <app appid='{ext_id}'>\n"
        f"    <updatecheck codebase='{codebase}' version='{version}'/>\n"
        "  </app>\n"
        "</gupdate>\n"
    )
    (out_dir / "update.xml").write_text(update_xml, encoding="utf-8")

    print(f"[done] version={version}")
    print(f"[done] EXTENSION_ID={ext_id}")
    print(f"[done] da ghi: {out_dir / 'botfake.crx'}, {out_dir / 'update.xml'}")


if __name__ == "__main__":
    main()
