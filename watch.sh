#!/bin/bash
pgrep -f io_consumer.py > /dev/null 2>&1 || (source ~/io_consumer.env && nohup python3 ~/io_consumer.py >> ~/io_consumer.log 2>&1 &)
pgrep -f ke_poll.sh > /dev/null 2>&1 || nohup bash ~/ke_poll.sh >> ~/ke_poll.log 2>&1 &
