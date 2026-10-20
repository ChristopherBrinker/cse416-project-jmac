#!/bin/sh
set -eu

worker_script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
worker_image=${1:-jmac-worker:0.4.0}
worker_output_directory=${2:-"$worker_script_directory/../output"}

mkdir -p "$worker_output_directory"
worker_output_directory=$(CDPATH= cd -- "$worker_output_directory" && pwd)
# Resolve the tag once so both evaluations run the exact same image.
worker_image_id=$(docker image inspect --format '{{.Id}}' "$worker_image")
worker_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$worker_image_id")

for worker_run in first second; do
    docker run --rm \
        --platform "$worker_platform" \
        --network none \
        --read-only \
        --tmpfs /tmp:rw,nosuid,nodev \
        --user "$(id -u):$(id -g)" \
        --mount "type=bind,source=$worker_output_directory,target=/output" \
        "$worker_image_id" \
        --benchmark /opt/worker/examples/benchmark.json \
        --model smollm2-135m \
        --output "/output/result-$worker_run.json"
done

cmp "$worker_output_directory/result-first.json" "$worker_output_directory/result-second.json"
printf '%s\n' "$worker_image_id" > "$worker_output_directory/image-id.txt"
printf 'Identical offline results from image %s\nResults: %s\n' \
    "$worker_image_id" "$worker_output_directory"
