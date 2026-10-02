#!/bin/sh
set -eu

# The CA and keys exist only in this test stack's Docker volume.
if [ -f /certificates/email.pem ] && openssl x509 -checkend 86400 -noout -in /certificates/email.pem; then
  exit 0
fi

openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
  -keyout /certificates/ca-key.pem -out /certificates/ca.pem \
  -subj '/CN=Traffic Usage Monitor container test CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign'

openssl req -new -newkey rsa:2048 -nodes \
  -keyout /certificates/email-key.pem -out /certificates/email.csr \
  -subj '/CN=email.api.engagelab.cc' \
  -addext 'subjectAltName=DNS:email.api.engagelab.cc'

openssl x509 -req -days 7 -in /certificates/email.csr \
  -CA /certificates/ca.pem -CAkey /certificates/ca-key.pem -CAcreateserial \
  -copy_extensions copy -out /certificates/email.pem
