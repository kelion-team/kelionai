@echo off
title Kelion - direct pe serverul Linux
ssh -t -i "C:\Users\adria\Kelionai-secrets\kelion-vps" root@164.68.120.87 "bash -lc 'set -a; source /root/kelion/claude.env; set +a; cd /root/kelion/repo; exec claude'"
pause
