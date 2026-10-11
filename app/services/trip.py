"""Game clock and billing: 1.5 seconds at the wheel = one trip minute."""

TIME_SCALE = 40
MAX_CITY_SPEED = 100


def charged_minutes(duration_ms):
    return max(1, (duration_ms * TIME_SCALE + 59999) // 60000)
