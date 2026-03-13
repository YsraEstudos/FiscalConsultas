import csv
from pathlib import Path

import fitz
import pytest

from backend.utils.nebs_parser import (
    NebsAuditRecord,
    NebsParseOutcome,
    parse_nebs_pdf,
    write_nebs_audit_report,
)

pytestmark = pytest.mark.unit


def _create_sample_nebs_pdf(path: Path) -> None:
    document = fitz.open()
    page = document.new_page()
    page.insert_text(
        (72, 72),
        "\n".join(
            [
                "(Fl. 21 do Anexo II da Portaria Conjunta RFB/SCS nº 1.429, de 12 de setembro de 2018.)",
                "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO",
                "1.0102.61  Serviços de construção de usinas de geração de energia",
                "Esta subposição inclui os serviços de:",
                "- Construção para todos os tipos de usinas de geração de energia, tais como, usinas hidrelétricas,",
                "termoelétricas, eólicas e nucleares.",
                "1.0999.99  Código inexistente para auditoria",
                "Texto sem vínculo com a NBS oficial.",
            ]
        ),
        fontsize=11,
    )
    document.save(path)
    document.close()


def test_parse_nebs_pdf_extracts_trusted_entries_and_marks_unknown_codes(tmp_path: Path):
    pdf_path = tmp_path / "nebs.pdf"
    _create_sample_nebs_pdf(pdf_path)

    outcome = parse_nebs_pdf(
        pdf_path,
        valid_nbs_items={
            "1.0102.61.00": "Serviços de construção de usinas de geração de energia",
        },
    )

    assert outcome.counts["trusted"] == 1
    assert outcome.counts["rejected"] == 1
    assert outcome.entries[0].code == "1.0102.61.00"
    assert outcome.entries[0].section_title == "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO"
    assert "termoelétricas" in outcome.entries[0].body_text
    assert outcome.entries[0].body_markdown is not None
    assert outcome.audit_records[0].code == "1.0999.99"
    assert "codigo_nao_encontrado_na_nbs" in outcome.audit_records[0].reasons


def test_write_nebs_audit_report_outputs_csv_and_json(tmp_path: Path):
    pdf_path = tmp_path / "nebs.pdf"
    _create_sample_nebs_pdf(pdf_path)
    outcome = parse_nebs_pdf(
        pdf_path,
        valid_nbs_items={
            "1.0102.61.00": "Serviços de construção de usinas de geração de energia",
        },
    )

    csv_path = tmp_path / "reports" / "nebs_audit.csv"
    json_path = tmp_path / "reports" / "nebs_audit.json"
    write_nebs_audit_report(outcome, csv_path=csv_path, json_path=json_path)

    csv_content = csv_path.read_text(encoding="utf-8")
    json_content = json_path.read_text(encoding="utf-8")

    assert "1.0999.99" in csv_content
    assert "codigo_nao_encontrado_na_nbs" in csv_content
    assert '"parser_status": "rejected"' in json_content


def test_write_nebs_audit_report_uses_csv_writer_for_multiline_fields(tmp_path: Path):
    outcome = NebsParseOutcome(
        audit_records=[
            NebsAuditRecord(
                code="1.0999.99",
                parser_status="rejected",
                reasons=("codigo_nao_encontrado_na_nbs",),
                section_title="SEÇÃO I",
                title="Título com, vírgula",
                page_start=1,
                page_end=2,
                excerpt="Primeira linha\nSegunda linha",
                raw_text="Texto bruto",
            )
        ]
    )

    csv_path = tmp_path / "reports" / "nebs_audit.csv"
    json_path = tmp_path / "reports" / "nebs_audit.json"

    write_nebs_audit_report(outcome, csv_path=csv_path, json_path=json_path)

    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle))

    assert rows[1][0] == "1.0999.99"
    assert rows[1][4] == "Título com, vírgula"
    assert rows[1][7] == "Primeira linha\nSegunda linha"


def test_parse_nebs_pdf_merges_multiline_titles_and_keeps_structured_body_trusted(tmp_path: Path):
    pdf_path = tmp_path / "nebs_multiline_title.pdf"
    document = fitz.open()
    page = document.new_page()
    page.insert_text(
        (72, 72),
        "\n".join(
            [
                "Fl. 22 do Anexo II da Portaria Conjunta RFB/SCS nº 1.429, de 12 de setembro de 2018.",
                "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO",
                "1.0200.10  Serviços especializados de apoio",
                "à construção e à montagem industrial",
                "Esta subposição inclui:",
                "- Apoio à montagem industrial.",
                "- Apoio à construção civil.",
            ]
        ),
        fontsize=11,
    )
    document.save(pdf_path)
    document.close()

    outcome = parse_nebs_pdf(
        pdf_path,
        valid_nbs_items={
            "1.0200.10": "Serviços especializados de apoio à construção e à montagem industrial",
        },
    )

    assert outcome.counts["trusted"] == 1
    assert outcome.counts["suspect"] == 0
    assert outcome.entries[0].title == "Serviços especializados de apoio à construção e à montagem industrial"
    assert "Apoio à montagem industrial." in outcome.entries[0].body_text


def test_parse_nebs_pdf_coalesces_complementary_duplicate_blocks(tmp_path: Path):
    pdf_path = tmp_path / "nebs_duplicate_blocks.pdf"
    document = fitz.open()
    first_page = document.new_page()
    first_page.insert_text(
        (72, 72),
        "\n".join(
            [
                "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO",
                "1.0300.20  Serviços de obra complementar",
                "Esta subposição inclui os serviços de preparação do local,",
            ]
        ),
        fontsize=11,
    )
    second_page = document.new_page()
    second_page.insert_text(
        (72, 72),
        "\n".join(
            [
                "SEÇÃO I - SERVIÇOS DE CONSTRUÇÃO",
                "1.0300.20  Serviços de obra complementar",
                "movimentação de materiais e acabamento inicial.",
            ]
        ),
        fontsize=11,
    )
    document.save(pdf_path)
    document.close()

    outcome = parse_nebs_pdf(
        pdf_path,
        valid_nbs_items={
            "1.0300.20": "Serviços de obra complementar",
        },
    )

    assert outcome.counts["trusted"] == 1
    assert outcome.counts["suspect"] == 0
    assert outcome.entries[0].page_start == 1
    assert outcome.entries[0].page_end == 2
    assert "movimentação de materiais" in outcome.entries[0].body_text
