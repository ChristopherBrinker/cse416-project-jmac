FROM python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2 AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/worker \
    PATH=/opt/worker/.venv/bin:$PATH \
    HF_HOME=/opt/model-cache \
    HF_XET_CACHE=/tmp/huggingface-xet \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1

WORKDIR /opt/worker

FROM base AS dependencies

COPY --from=ghcr.io/astral-sh/uv:0.12.3@sha256:2d890623d310b57771ce840f0da5eed5fc6d657da05ffaa45d82797b53fa3abc /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock .python-version ./
RUN --mount=type=cache,target=/root/.cache/uv \
    UV_LINK_MODE=copy uv sync --locked --extra inference --no-dev \
    --python /usr/local/bin/python --no-python-downloads

FROM dependencies AS model

COPY jmac_worker/ ./jmac_worker/
# Fetch only the pinned public model's runtime assets and upstream notices.
RUN python -c 'from huggingface_hub import snapshot_download; from jmac_worker.inference import MODEL_ID, MODEL_REVISION; snapshot_download(repo_id=MODEL_ID, revision=MODEL_REVISION, cache_dir="/opt/model-cache", token=False, allow_patterns=["config.json", "generation_config.json", "model.safetensors", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "chat_template.jinja", "vocab.json", "merges.txt", "README.md", "LICENSE*"])' \
    && chmod -R a+rX /opt/model-cache

FROM model AS verified

COPY tests/ ./tests/
COPY examples/ ./examples/
RUN --network=none python -m unittest discover -s tests -v

FROM base AS runtime

LABEL org.opencontainers.image.title="JMAC evaluation worker" \
      org.opencontainers.image.version="0.3.0" \
      org.opencontainers.image.description="Pinned CPU evaluator with provider presence lifecycle"

ENV HF_HUB_OFFLINE=1

COPY --from=verified /opt/worker/.venv /opt/worker/.venv
COPY --from=verified /opt/worker/jmac_worker /opt/worker/jmac_worker
COPY --from=verified /opt/worker/examples /opt/worker/examples
COPY --from=verified /opt/model-cache /opt/model-cache
COPY third_party/ /opt/worker/third_party/

RUN mkdir /output && chown 10001:10001 /output
USER 10001:10001
WORKDIR /output

ENTRYPOINT ["/opt/worker/.venv/bin/python", "-m", "jmac_worker", "--cache-dir", "/opt/model-cache", "--offline"]
CMD ["--help"]
