# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

WORKDIR /srv/finverse
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .

# The MiroFish source is supplied as a named build context by compose.  The
# FINVERSE API remains the public surface; this is the internal runtime engine.
COPY --from=mirofish_source backend /opt/mirofish/backend
COPY --from=mirofish_source LICENSE /opt/mirofish/LICENSE

# Keep both platform loops, but serialize their expensive inference batches
# and cap the per-platform OASIS semaphore for the collector host's memory.
RUN python deploy/patch_mirofish_runtime.py /opt/mirofish/backend/scripts/run_parallel_simulation.py

ENV MIROFISH_OFFLINE_PATH=/opt/mirofish
CMD ["uv", "run", "--no-sync", "python", "-m", "services.finverse_simulation_api"]
