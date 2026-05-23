#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

echo "This will delete all recorded hardware data under:"
echo "  ${DATA_DIR}"
echo
echo "Type 'confirm' to continue:"
read -r response

if [[ "${response}" != "confirm" ]]; then
  echo "Aborted."
  exit 1
fi

shopt -s nullglob dotglob

for path in "${DATA_DIR}"/*; do
  if [[ "${path}" == "${DATA_DIR}/clear.sh" ]]; then
    continue
  fi

  if [[ -d "${path}" ]]; then
    rm -rf -- "${path:?}/"*
  else
    rm -f -- "${path}"
  fi
done

echo "Cleared hardware data."
