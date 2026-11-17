"""Reproducible synthetic evaluation. Uses the mock provider unless --hosted is explicit."""

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path

from app.ai.mock import MockLLMProvider
from app.core.config import settings
from app.schemas.analysis import AnalysisRequest
from app.services.analysis import analyze_guest_request

CATEGORIES = ["financial", "subscription", "cancellation", "refund", "privacy", "commitment"]
ROOT = Path(__file__).resolve().parents[2]


async def evaluate(hosted=False):
    if hosted and settings.llm_provider != "openai":
        raise ValueError("Configure LLM_PROVIDER=openai before a hosted evaluation")
    cases = [
        json.loads(line)
        for line in (ROOT / "evaluation/cases.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    counts = {key: [0, 0, 0] for key in CATEGORIES}
    rows, latency, supported, findings, cost = [], [], 0, 0, 0
    for case in cases:
        request = AnalysisRequest(
            source_url="https://example.test/evaluation",
            sections=[
                {
                    "section_id": case["id"],
                    "source_url": "https://example.test/evaluation",
                    "text": case["text"],
                }
            ],
        )
        start = time.perf_counter()
        report = await analyze_guest_request(request, None if hosted else MockLLMProvider())
        latency.append((time.perf_counter() - start) * 1000)
        predicted, expected = {item.category for item in report.findings}, set(case["expected"])
        for category in CATEGORIES:
            counts[category][0] += int(category in predicted and category in expected)
            counts[category][1] += int(category in predicted and category not in expected)
            counts[category][2] += int(category not in predicted and category in expected)
        for finding in report.findings:
            findings += 1
            supported += int(finding.evidence.quote in case["text"])
        cost += report.metadata.estimated_cost_usd
        case["split"] = "challenge" if case["split"] == "held-out" else case["split"]
        rows.append(
            f"| {case['id']} | {case['split']} | {', '.join(sorted(expected)) or 'none'} | "
            f"{', '.join(sorted(predicted)) or 'none'} |"
        )
    output = [
        "# Synthetic extraction evaluation",
        "",
        f"Provider: {'configured hosted provider' if hosted else 'deterministic mock provider'}.",
        "These synthetic author-labelled cases are a regression check, not a representative "
        "legal corpus, independent annotation study, or hosted-model quality claim.",
        "",
        "| Category | Precision | Recall | F1 |",
        "| --- | ---: | ---: | ---: |",
    ]
    for category, (tp, fp, fn) in counts.items():
        precision = tp / (tp + fp) if tp + fp else 0
        recall = tp / (tp + fn) if tp + fn else 0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
        output.append(f"| {category} | {precision:.3f} | {recall:.3f} | {f1:.3f} |")
    output.extend(
        [
            "",
            f"Cases: {len(cases)}; supported quotes: {supported}/{findings}; "
            f"median backend latency: {statistics.median(latency):.2f} ms; "
            f"estimated provider cost: USD {cost:.6f}.",
            "",
            "Quote support measures exact source occurrence, not semantic entailment. "
            "Date/amount accuracy, hallucination rates, production latency and user "
            "comprehension require a larger independently labelled evaluation.",
            "",
            "| Case | Split | Expected categories | Predicted categories |",
            "| --- | --- | --- | --- |",
            *rows,
            "",
        ]
    )
    target = ROOT / "docs/ai-evaluation.md"
    target.parent.mkdir(exist_ok=True)
    target.write_text("\n".join(output), encoding="utf-8")
    print(f"Wrote {target.name}: {len(cases)} cases, {supported}/{findings} supported quotes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--hosted", action="store_true", help="Use configured provider; may incur cost"
    )
    asyncio.run(evaluate(parser.parse_args().hosted))
