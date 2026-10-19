#!/bin/sh
# SSH forced command of the deploy-masterdriver account (installed as /usr/local/bin/masterdriver-forced-command).
# Whatever the connection asks to run, only its words are handed to masterdriver-deploy, which checks each one.
set -f
exec sudo -n /usr/local/sbin/masterdriver-deploy $SSH_ORIGINAL_COMMAND
