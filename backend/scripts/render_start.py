"""Single-instance Render demo startup; paid deployments should use a pre-deploy migration."""

from alembic import command
from alembic.config import Config

from scripts.serve import main

if __name__ == "__main__":
    command.upgrade(Config("alembic.ini"), "head")
    main()
