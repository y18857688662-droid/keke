#!/bin/bash
C=$(pgrep -cf io_consumer.py 2>/dev/null || echo 0)
if [ "$C" -gt 1 ]; then
    pkill -9 -f io_consumer.py
    sleep 2
fi
if ! pgrep -f io_consumer.py > /dev/null 2>&1; then
    source ~/io_consumer.env && nohup python3 ~/io_consumer.py >> ~/io_consumer.log 2>&1 &
fi
pgrep -f ke_poll.sh > /dev/null 2>&1 || nohup bash ~/ke_poll.sh >> ~/ke_poll.log 2>&1 &
