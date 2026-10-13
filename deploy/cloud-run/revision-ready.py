import json
import sys


def ready_status(revision):
    conditions = revision.get("status", {}).get("conditions", [])
    return next(
        (condition.get("status", "Unknown") for condition in conditions
         if condition.get("type") == "Ready"),
        "Unknown",
    )


if __name__ == "__main__":
    print(ready_status(json.load(sys.stdin)))
